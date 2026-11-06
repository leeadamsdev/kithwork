import { TRPCError } from "@trpc/server";

export const issueUnavailable = () =>
  new TRPCError({
    code: "NOT_FOUND",
    message: "Team, issue or status not found",
  });
export const issueConflict = (message: string) =>
  new TRPCError({ code: "CONFLICT", message });
export const issueForbidden = () =>
  new TRPCError({
    code: "FORBIDDEN",
    message: "Insufficient issue permissions",
  });
