import { invitationStatuses, type InvitationRole } from "@kithwork/contracts";
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth.js";
import { organisation, organisationRole } from "./organisations.js";

export const invitationStatus = pgEnum("invitation_status", invitationStatuses);
export const organisationInvitation = pgTable(
  "organisation_invitation",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisation.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: organisationRole("role").$type<InvitationRole>().notNull(),
    issuerId: uuid("issuer_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    version: integer("version").default(1).notNull(),
    tokenHash: text("token_hash").notNull(),
    status: invitationStatus("status").default("pending").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastIssuedAt: timestamp("last_issued_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    acceptedBy: uuid("accepted_by").references(() => user.id, {
      onDelete: "restrict",
    }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("organisation_invitation_pending_recipient_unique")
      .on(table.organisationId, table.email)
      .where(sql`${table.status} = 'pending'`),
    index("organisation_invitation_org_idx").on(table.organisationId, table.id),
    index("organisation_invitation_issuer_idx")
      .on(table.organisationId, table.issuerId)
      .where(sql`${table.status} = 'pending'`),
    index("organisation_invitation_expiry_idx").on(table.expiresAt),
    check(
      "organisation_invitation_role",
      sql`${table.role} in ('member','admin')`,
    ),
    check(
      "organisation_invitation_email",
      sql`${table.email} = lower(btrim(${table.email})) and char_length(${table.email}) between 3 and 254`,
    ),
    check(
      "organisation_invitation_token_hash",
      sql`${table.tokenHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check("organisation_invitation_version", sql`${table.version} > 0`),
    check(
      "organisation_invitation_acceptance",
      sql`(${table.status} = 'accepted' and ${table.acceptedBy} is not null and ${table.acceptedAt} is not null) or (${table.status} <> 'accepted' and ${table.acceptedBy} is null and ${table.acceptedAt} is null)`,
    ),
  ],
);
