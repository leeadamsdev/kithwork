import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { organisationInvitation } from "./invitations.js";

export const emailOutbox = pgTable(
  "email_outbox",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    type: text("type").default("organisation.invitation_email.v1").notNull(),
    invitationId: uuid("invitation_id")
      .notNull()
      .references(() => organisationInvitation.id, { onDelete: "cascade" }),
    invitationVersion: integer("invitation_version").notNull(),
    payload: jsonb("payload").$type<unknown>(),
    requestId: uuid("request_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    nextPublishAt: timestamp("next_publish_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    publishLeaseId: uuid("publish_lease_id"),
    publishLeaseUntil: timestamp("publish_lease_until", { withTimezone: true }),
    publicationAttempts: integer("publication_attempts").default(0).notNull(),
    lastPublishedAt: timestamp("last_published_at", { withTimezone: true }),
    deliveryLeaseId: uuid("delivery_lease_id"),
    deliveryLeaseUntil: timestamp("delivery_lease_until", {
      withTimezone: true,
    }),
    deliveryAttempts: integer("delivery_attempts").default(0).notNull(),
    outcome: text("outcome", { enum: ["sent", "skipped", "failed"] }),
    lastErrorCode: text("last_error_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("email_outbox_invitation_version_unique").on(
      table.invitationId,
      table.invitationVersion,
    ),
    index("email_outbox_ready_idx")
      .on(table.nextPublishAt, table.id)
      .where(sql`${table.completedAt} is null`),
    index("email_outbox_retention_idx")
      .on(table.completedAt)
      .where(sql`${table.completedAt} is not null`),
    check(
      "email_outbox_type",
      sql`${table.type} = 'organisation.invitation_email.v1'`,
    ),
    check("email_outbox_version", sql`${table.invitationVersion} > 0`),
    check(
      "email_outbox_attempts",
      sql`${table.publicationAttempts} >= 0 and ${table.deliveryAttempts} between 0 and 5`,
    ),
    check(
      "email_outbox_outcome",
      sql`${table.outcome} is null or ${table.outcome} in ('sent','skipped','failed')`,
    ),
    check(
      "email_outbox_completion",
      sql`(${table.completedAt} is null and ${table.outcome} is null and ${table.payload} is not null) or (${table.completedAt} is not null and ${table.outcome} is not null and ${table.payload} is null)`,
    ),
    check(
      "email_outbox_publication_lease",
      sql`(${table.publishLeaseId} is null) = (${table.publishLeaseUntil} is null)`,
    ),
    check(
      "email_outbox_delivery_lease",
      sql`(${table.deliveryLeaseId} is null) = (${table.deliveryLeaseUntil} is null)`,
    ),
  ],
);
