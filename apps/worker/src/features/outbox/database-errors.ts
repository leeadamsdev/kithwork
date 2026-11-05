import { DrizzleQueryError } from "drizzle-orm";
export function retryableDatabaseError(error: unknown): boolean {
  const cause = error instanceof DrizzleQueryError ? error.cause : error;
  if (!(cause instanceof Error)) return false;
  if ("code" in cause && typeof cause.code === "string")
    return (
      /^(08|53)/.test(cause.code) ||
      [
        "57P01",
        "57P02",
        "57P03",
        "40001",
        "40P01",
        "55P03",
        "57014",
        "ECONNREFUSED",
        "ECONNRESET",
        "EPIPE",
        "ETIMEDOUT",
        "ENOTFOUND",
        "EAI_AGAIN",
      ].includes(cause.code)
    );
  // pg/pg-pool report connection loss and pool acquisition timeouts without a code.
  return [
    "Connection terminated unexpectedly",
    "Connection terminated due to connection timeout",
    "timeout exceeded when trying to connect",
  ].includes(cause.message);
}
