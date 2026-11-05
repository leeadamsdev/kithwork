import type { AuthenticatedUser } from "@kithwork/contracts";
import type { FastifyBaseLogger } from "fastify";
import type { Database } from "../database/types.js";
export interface ApiContext {
  requestId: string;
  log: FastifyBaseLogger;
  db: Database;
  user: AuthenticatedUser | null;
  consumeOrganisationCreationLimit: (actorId: string) => Promise<void>;
}
