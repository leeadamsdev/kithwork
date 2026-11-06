import { TRPCError } from "@trpc/server";
export const teamUnavailable = () =>
  new TRPCError({ code: "NOT_FOUND", message: "Team or membership not found" });
export const teamForbidden = () =>
  new TRPCError({
    code: "FORBIDDEN",
    message: "Insufficient team permissions",
  });
export const teamConflict = (message: string) =>
  new TRPCError({ code: "CONFLICT", message });
