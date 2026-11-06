import { projectStatuses } from "@kithwork/contracts";
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
import { organisation } from "./organisations.js";
import { team } from "./teams.js";

export const projectStatus = pgEnum("project_status", projectStatuses);
export const project = pgTable(
  "project",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisation.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    status: projectStatus("status").default("planned").notNull(),
    startDate: date("start_date", { mode: "string" }),
    targetDate: date("target_date", { mode: "string" }),
    version: integer("version").default(1).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    unique("project_organisation_id_unique").on(table.organisationId, table.id),
    check(
      "project_name_length",
      sql`char_length(btrim(${table.name})) between 1 and 100`,
    ),
    check(
      "project_description_length",
      sql`char_length(${table.description}) <= 2000`,
    ),
    check("project_version_positive", sql`${table.version} > 0`),
    check("project_date_order", sql`${table.targetDate} >= ${table.startDate}`),
  ],
);
export const projectTeam = pgTable(
  "project_team",
  {
    organisationId: uuid("organisation_id").notNull(),
    projectId: uuid("project_id").notNull(),
    teamId: uuid("team_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.organisationId, table.projectId, table.teamId],
    }),
    foreignKey({
      name: "project_team_project_fk",
      columns: [table.organisationId, table.projectId],
      foreignColumns: [project.organisationId, project.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "project_team_team_fk",
      columns: [table.organisationId, table.teamId],
      foreignColumns: [team.organisationId, team.id],
    }).onDelete("cascade"),
    index("project_team_team_idx").on(
      table.organisationId,
      table.teamId,
      table.projectId,
    ),
  ],
);
