import type { IssueChangeValues } from "@kithwork/contracts";
import type { Database } from "../../platform/database/types.js";
import { readVisibleIssueProjects } from "./project-links.js";

export async function resolveIssueActivityChanges(
  db: Database,
  actorId: string,
  organisationId: string,
  changes: IssueChangeValues[],
) {
  const ids = [
    ...new Set(
      changes.flatMap((value) =>
        value.project
          ? [value.project.from, value.project.to].filter((id) => id !== null)
          : [],
      ),
    ),
  ];
  const projects = new Map(
    (await readVisibleIssueProjects(db, actorId, organisationId, ids)).map(
      (row) => [row.id, row],
    ),
  );
  const reference = (id: string | null) => {
    if (id === null) return null;
    const row = projects.get(id);
    return row
      ? { available: true as const, id: row.id, name: row.name }
      : { available: false as const };
  };
  return changes.map((value) => {
    const { project, ...rest } = value;
    return {
      ...rest,
      ...(project
        ? {
            project: {
              from: reference(project.from),
              to: reference(project.to),
            },
          }
        : {}),
    };
  });
}
