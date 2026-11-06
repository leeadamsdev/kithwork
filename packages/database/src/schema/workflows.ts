import { workflowCategories } from "@kithwork/contracts";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { team } from "./teams.js";

export const workflowCategory = pgEnum("workflow_category", workflowCategories);
export const teamWorkflow = pgTable(
  "team_workflow",
  {
    organisationId: uuid("organisation_id").notNull(),
    teamId: uuid("team_id").notNull(),
    version: integer("version").default(1).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    primaryKey({ columns: [table.organisationId, table.teamId] }),
    foreignKey({
      name: "team_workflow_team_fk",
      columns: [table.organisationId, table.teamId],
      foreignColumns: [team.organisationId, team.id],
    }).onDelete("cascade"),
    check("team_workflow_version_positive", sql`${table.version} > 0`),
  ],
);
export const workflowStatus = pgTable(
  "workflow_status",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organisationId: uuid("organisation_id").notNull(),
    teamId: uuid("team_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    category: workflowCategory("category").notNull(),
    position: integer("position").notNull(),
    isDefault: boolean("is_default").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      name: "workflow_status_workflow_fk",
      columns: [table.organisationId, table.teamId],
      foreignColumns: [teamWorkflow.organisationId, teamWorkflow.teamId],
    }).onDelete("cascade"),
    unique("workflow_status_team_id_unique").on(
      table.organisationId,
      table.teamId,
      table.id,
    ),
    uniqueIndex("workflow_status_name_unique").on(
      table.organisationId,
      table.teamId,
      sql`lower(btrim(${table.name}))`,
    ),
    uniqueIndex("workflow_status_default_unique")
      .on(table.organisationId, table.teamId)
      .where(sql`${table.isDefault}`),
    check(
      "workflow_status_name_length",
      sql`char_length(btrim(${table.name})) between 1 and 50`,
    ),
    check(
      "workflow_status_description_length",
      sql`char_length(${table.description}) <= 500`,
    ),
    check("workflow_status_position_nonnegative", sql`${table.position} >= 0`),
    check(
      "workflow_status_default_active_category",
      sql`not ${table.isDefault} or (${table.retiredAt} is null and ${table.category} in ('backlog','unstarted'))`,
    ),
  ],
);
