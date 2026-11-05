import type { createDatabase } from "@kithwork/database";
import type { FastifyBaseLogger } from "fastify";
import type { AuthenticatedUser } from "@kithwork/contracts";

export interface ApiContext {
  requestId: string;
  log: FastifyBaseLogger;
  db: ReturnType<typeof createDatabase>["db"];
  user: AuthenticatedUser | null;
  consumeOrganisationCreationLimit: (actorId: string) => Promise<void>;
}
