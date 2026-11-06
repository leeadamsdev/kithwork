import {
  issueActivityKinds,
  type IssueChangeValues,
} from "@kithwork/contracts";
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth.js";
import { issue } from "./issues.js";

export const issueActivityKind = pgEnum(
  "issue_activity_kind",
  issueActivityKinds,
);
export const issueActivity = pgTable(
  "issue_activity",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organisationId: uuid("organisation_id").notNull(),
    issueId: uuid("issue_id").notNull(),
    issueVersion: integer("issue_version").notNull(),
    actorId: uuid("actor_id").references(() => user.id, {
      onDelete: "set null",
    }),
    actorName: text("actor_name").notNull(),
    kind: issueActivityKind("kind").notNull(),
    cause: text("cause").notNull(),
    changes: jsonb("changes").$type<IssueChangeValues>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "issue_activity_issue_fk",
      columns: [table.organisationId, table.issueId],
      foreignColumns: [issue.organisationId, issue.id],
    }).onDelete("cascade"),
    unique("issue_activity_version_unique").on(
      table.organisationId,
      table.issueId,
      table.issueVersion,
    ),
    check("issue_activity_version_positive", sql`${table.issueVersion} > 0`),
    check(
      "issue_activity_cause",
      sql`${table.cause} in ('user','organisation_member_removed','organisation_member_left','team_member_removed','team_member_left','team_visibility_changed','organisation_role_changed')`,
    ),
    check(
      "issue_activity_changes_object",
      sql`jsonb_typeof(${table.changes}) = 'object'`,
    ),
  ],
);
