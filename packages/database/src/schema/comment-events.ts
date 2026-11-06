import { issueCommentEventKinds } from "@kithwork/contracts";
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth.js";
import { issueComment } from "./comments.js";

export const issueCommentEventKind = pgEnum(
  "issue_comment_event_kind",
  issueCommentEventKinds,
);
export const issueCommentEvent = pgTable(
  "issue_comment_event",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organisationId: uuid("organisation_id").notNull(),
    issueId: uuid("issue_id").notNull(),
    commentId: uuid("comment_id").notNull(),
    commentVersion: integer("comment_version").notNull(),
    kind: issueCommentEventKind("kind").notNull(),
    actorId: uuid("actor_id").references(() => user.id, {
      onDelete: "set null",
    }),
    actorName: text("actor_name").notNull(),
    requestId: uuid("request_id"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "issue_comment_event_comment_fk",
      columns: [table.organisationId, table.issueId, table.commentId],
      foreignColumns: [
        issueComment.organisationId,
        issueComment.issueId,
        issueComment.id,
      ],
    }).onDelete("cascade"),
    unique("issue_comment_event_version_unique").on(
      table.organisationId,
      table.issueId,
      table.commentId,
      table.commentVersion,
    ),
    check(
      "issue_comment_event_version_positive",
      sql`${table.commentVersion}>0`,
    ),
  ],
);
