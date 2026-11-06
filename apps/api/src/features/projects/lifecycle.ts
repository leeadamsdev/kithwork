import type { VersionedProjectInput } from "@kithwork/contracts";
import type { Database } from "../../platform/database/types.js";
import { projectForbidden } from "./errors.js";
import { canManageProject } from "./policies.js";
import { getProject } from "./queries.js";
import { requireActiveProjectTeam } from "./team-access.js";
import {
  requireProjectVersion,
  saveProject,
  withLockedProject,
} from "./transaction.js";

export function setProjectArchived(
  db: Database,
  actorId: string,
  input: VersionedProjectInput,
  archived: boolean,
) {
  return withLockedProject(db, actorId, input, [], async (tx, access) => {
    if (
      !canManageProject(
        access.organisationRole,
        access.teams.map((row) => row.role),
      )
    )
      throw projectForbidden();
    if ((access.project.archivedAt !== null) === archived)
      return getProject(tx, actorId, input);
    requireProjectVersion(access.project, input.expectedVersion);
    if (!archived)
      await requireActiveProjectTeam(tx, input.organisationId, input.projectId);
    await saveProject(tx, access.project, {
      archivedAt: archived ? new Date() : null,
    });
    return getProject(tx, actorId, input);
  });
}
