import { DrizzleQueryError } from "drizzle-orm";

// SQLSTATE is safe diagnostic metadata; query messages, parameters and causes are not.
export function databaseErrorCode(error: unknown): string | undefined {
  const cause = error instanceof DrizzleQueryError ? error.cause : error;
  if (
    cause instanceof Error &&
    "code" in cause &&
    typeof cause.code === "string" &&
    /^[0-9A-Z]{5}$/.test(cause.code)
  )
    return cause.code;
  return undefined;
}
