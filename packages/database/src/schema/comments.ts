import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth.js";
import { issue } from "./issues.js";

export const issueComment = pgTable(
  "issue_comment",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organisationId: uuid("organisation_id").notNull(),
    issueId: uuid("issue_id").notNull(),
    authorId: uuid("author_id").references(() => user.id, {
      onDelete: "set null",
    }),
    authorName: text("author_name").notNull(),
    body: text("body"),
    version: integer("version").default(1).notNull(),
    creationKey: uuid("creation_key").notNull(),
    creationHash: text("creation_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 })
      .defaultNow()
      .notNull(),
    editedAt: timestamp("edited_at", { withTimezone: true, precision: 3 }),
    deletedAt: timestamp("deleted_at", { withTimezone: true, precision: 3 }),
  },
  (table) => [
    foreignKey({
      name: "issue_comment_issue_fk",
      columns: [table.organisationId, table.issueId],
      foreignColumns: [issue.organisationId, issue.id],
    }).onDelete("cascade"),
    unique("issue_comment_scope_unique").on(
      table.organisationId,
      table.issueId,
      table.id,
    ),
    unique("issue_comment_creation_unique").on(
      table.organisationId,
      table.issueId,
      table.authorId,
      table.creationKey,
    ),
    index("issue_comment_created_idx").on(
      table.organisationId,
      table.issueId,
      table.createdAt,
      table.id,
    ),
    check("issue_comment_version_positive", sql`${table.version}>0`),
    check(
      "issue_comment_creation_hash",
      sql`${table.creationHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "issue_comment_body_length",
      sql`char_length(btrim(${table.body})) between 1 and 20000 and char_length(${table.body}) <= 20000`,
    ),
    check(
      "issue_comment_deleted_body",
      sql`(${table.deletedAt} is null and ${table.body} is not null) or (${table.deletedAt} is not null and ${table.body} is null)`,
    ),
  ],
);
