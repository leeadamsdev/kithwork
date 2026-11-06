import { TRPCError } from "@trpc/server";
export const missing = () =>
  new TRPCError({
    code: "NOT_FOUND",
    message: "Organisation or membership not found",
  });

export const forbidden = () =>
  new TRPCError({
    code: "FORBIDDEN",
    message: "Insufficient organisation permissions",
  });

export const invitationUnavailable = () =>
  new TRPCError({
    code: "NOT_FOUND",
    message: "Invitation not found or unavailable",
  });
