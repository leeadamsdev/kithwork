import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth.js";
import { issueComment } from "./comments.js";

export const issueCommentMention = pgTable(
  "issue_comment_mention",
  {
    organisationId: uuid("organisation_id").notNull(),
    issueId: uuid("issue_id").notNull(),
    commentId: uuid("comment_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    firstMentionedVersion: integer("first_mentioned_version").notNull(),
    active: boolean("active").default(true).notNull(),
  },
  (table) => [
    primaryKey({
      name: "issue_comment_mention_pk",
      columns: [
        table.organisationId,
        table.issueId,
        table.commentId,
        table.userId,
      ],
    }),
    foreignKey({
      name: "issue_comment_mention_comment_fk",
      columns: [table.organisationId, table.issueId, table.commentId],
      foreignColumns: [
        issueComment.organisationId,
        issueComment.issueId,
        issueComment.id,
      ],
    }).onDelete("cascade"),
    index("issue_comment_mention_user_idx").on(table.userId),
    check(
      "issue_comment_mention_version_positive",
      sql`${table.firstMentionedVersion}>0`,
    ),
  ],
);
