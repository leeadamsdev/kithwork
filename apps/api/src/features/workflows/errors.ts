import { TRPCError } from "@trpc/server";
import { DrizzleQueryError } from "drizzle-orm";

export const workflowUnavailable = () =>
  new TRPCError({
    code: "NOT_FOUND",
    message: "Team, workflow or status not found",
  });
export const workflowForbidden = () =>
  new TRPCError({
    code: "FORBIDDEN",
    message: "Insufficient workflow permissions",
  });
export const workflowConflict = (message: string) =>
  new TRPCError({ code: "CONFLICT", message });
export function rethrowWorkflowWriteError(error: unknown): never {
  const cause = error instanceof DrizzleQueryError ? error.cause : error;
  if (
    cause instanceof Error &&
    "code" in cause &&
    cause.code === "23505" &&
    "constraint" in cause &&
    cause.constraint === "workflow_status_name_unique"
  )
    throw workflowConflict("Status name is already in use");
  throw error;
}
