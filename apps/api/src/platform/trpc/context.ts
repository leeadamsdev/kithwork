import type { AuthenticatedUser } from "@kithwork/contracts";
import type { FastifyBaseLogger } from "fastify";
import type { Database } from "../database/types.js";
import type { InvitationEmailConfig } from "../../features/organisations/invitations/email.js";
export interface ApiContext {
  requestId: string;
  log: FastifyBaseLogger;
  db: Database;
  user: AuthenticatedUser | null;
  invitationEmail: InvitationEmailConfig;
  consumeOrganisationCreationLimit: (actorId: string) => Promise<void>;
  consumeInvitationSendLimit: (
    actorId: string,
    organisationId: string,
  ) => Promise<void>;
  consumeInvitationAccessLimit: (actorId: string) => Promise<void>;
}
