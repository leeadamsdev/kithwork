import type { SetProjectTeamsInput } from "@kithwork/contracts";
import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "../../platform/database/types.js";
import { projectTeam } from "./access.js";
import { projectForbidden } from "./errors.js";
import { canManageProject } from "./policies.js";
import { getProject } from "./queries.js";
import { requireSelectedTeams } from "./team-access.js";
import { requireUnlinkedProjectTeams } from "../issues/project-guard.js";
import {
  requireActiveProject,
  requireProjectVersion,
  saveProject,
  withLockedProject,
} from "./transaction.js";

export function setProjectTeams(
  db: Database,
  actorId: string,
  input: SetProjectTeamsInput,
) {
  return withLockedProject(
    db,
    actorId,
    input,
    input.teamIds,
    async (tx, access) => {
      const current = access.teams.filter((row) =>
        access.currentIds.includes(row.team.id),
      );
      // Check the full current set before inspecting proposed associations, including hidden targets.
      if (
        !canManageProject(
          access.organisationRole,
          current.map((row) => row.role),
        )
      )
        throw projectForbidden();
      requireActiveProject(access.project);
      requireProjectVersion(access.project, input.expectedVersion);
      requireSelectedTeams(
        access.teams,
        input.teamIds,
        access.currentIds,
        access.organisationRole,
      );
      const desiredIds = new Set<string>(input.teamIds);
      const removed = access.currentIds.filter((id) => !desiredIds.has(id));
      const added = input.teamIds.filter(
        (id) => !access.currentIds.includes(id),
      );
      await requireUnlinkedProjectTeams(
        tx,
        input.organisationId,
        input.projectId,
        removed,
      );
      if (removed.length)
        await tx
          .delete(projectTeam)
          .where(
            and(
              eq(projectTeam.organisationId, input.organisationId),
              eq(projectTeam.projectId, input.projectId),
              inArray(projectTeam.teamId, removed),
            ),
          );
      if (added.length)
        await tx.insert(projectTeam).values(
          added.map((teamId) => ({
            organisationId: input.organisationId,
            projectId: input.projectId,
            teamId,
          })),
        );
      if (removed.length || added.length)
        await saveProject(tx, access.project, {});
      return getProject(tx, actorId, input);
    },
  );
}
