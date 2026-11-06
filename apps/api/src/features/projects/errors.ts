import { TRPCError } from "@trpc/server";
export const projectUnavailable = () =>
  new TRPCError({ code: "NOT_FOUND", message: "Project or team not found" });
export const projectForbidden = () =>
  new TRPCError({
    code: "FORBIDDEN",
    message: "Insufficient project permissions",
  });
export const projectConflict = (message: string) =>
  new TRPCError({ code: "CONFLICT", message });
