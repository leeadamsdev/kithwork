import { issuePriorities } from "@kithwork/contracts";
import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth.js";
import { team } from "./teams.js";
import { workflowStatus } from "./workflows.js";
import { organisationMember } from "./organisations.js";
import { projectTeam } from "./projects.js";

export const issuePriority = pgEnum("issue_priority", issuePriorities);
export const issueCounter = pgTable(
  "issue_counter",
  {
    organisationId: uuid("organisation_id").notNull(),
    teamId: uuid("team_id").notNull(),
    lastNumber: integer("last_number").default(0).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.organisationId, table.teamId] }),
    foreignKey({
      name: "issue_counter_team_fk",
      columns: [table.organisationId, table.teamId],
      foreignColumns: [team.organisationId, team.id],
    }).onDelete("cascade"),
    check("issue_counter_number_nonnegative", sql`${table.lastNumber} >= 0`),
  ],
);
export const issue = pgTable(
  "issue",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organisationId: uuid("organisation_id").notNull(),
    teamId: uuid("team_id").notNull(),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    statusId: uuid("status_id").notNull(),
    priority: issuePriority("priority").default("none").notNull(),
    dueDate: date("due_date", { mode: "string" }),
    version: integer("version").default(1).notNull(),
    creatorId: uuid("creator_id").references(() => user.id, {
      onDelete: "set null",
    }),
    assigneeId: uuid("assignee_id"),
    projectId: uuid("project_id"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
    archivedAt: timestamp("archived_at", { withTimezone: true, precision: 3 }),
  },
  (table) => [
    unique("issue_organisation_id_unique").on(table.organisationId, table.id),
    unique("issue_team_number_unique").on(
      table.organisationId,
      table.teamId,
      table.number,
    ),
    foreignKey({
      name: "issue_team_fk",
      columns: [table.organisationId, table.teamId],
      foreignColumns: [team.organisationId, team.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "issue_status_fk",
      columns: [table.organisationId, table.teamId, table.statusId],
      foreignColumns: [
        workflowStatus.organisationId,
        workflowStatus.teamId,
        workflowStatus.id,
      ],
    }),
    foreignKey({
      name: "issue_assignee_member_fk",
      columns: [table.organisationId, table.assigneeId],
      foreignColumns: [
        organisationMember.organisationId,
        organisationMember.userId,
      ],
    }),
    foreignKey({
      name: "issue_project_team_fk",
      columns: [table.organisationId, table.projectId, table.teamId],
      foreignColumns: [
        projectTeam.organisationId,
        projectTeam.projectId,
        projectTeam.teamId,
      ],
    }),
    check(
      "issue_title_length",
      sql`char_length(btrim(${table.title})) between 1 and 200`,
    ),
    check(
      "issue_description_length",
      sql`char_length(${table.description}) <= 20000`,
    ),
    check("issue_number_positive", sql`${table.number} > 0`),
    check("issue_version_positive", sql`${table.version} > 0`),
    check(
      "issue_due_date_range",
      sql`${table.dueDate} between date '0001-01-01' and date '9999-12-31'`,
    ),
    index("issue_organisation_created_idx").on(
      table.organisationId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    index("issue_team_created_idx").on(
      table.organisationId,
      table.teamId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    index("issue_assignee_created_idx")
      .on(
        table.organisationId,
        table.assigneeId,
        table.createdAt.desc(),
        table.id.desc(),
      )
      .where(sql`${table.assigneeId} is not null`),
    index("issue_project_created_idx")
      .on(
        table.organisationId,
        table.projectId,
        table.createdAt.desc(),
        table.id.desc(),
      )
      .where(sql`${table.projectId} is not null`),
  ],
);
