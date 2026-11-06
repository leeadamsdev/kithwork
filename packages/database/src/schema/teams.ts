import { teamRoles, teamVisibilities } from "@kithwork/contracts";
import { sql } from "drizzle-orm";
import {
  check,
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
import { organisation, organisationMember } from "./organisations.js";

export const teamRole = pgEnum("team_role", teamRoles);
export const teamVisibility = pgEnum("team_visibility", teamVisibilities);
export const team = pgTable(
  "team",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisation.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    key: text("key").notNull(),
    description: text("description"),
    visibility: teamVisibility("visibility").default("organisation").notNull(),
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
    unique("team_organisation_id_unique").on(table.organisationId, table.id),
    unique("team_organisation_key_unique").on(table.organisationId, table.key),
    check(
      "team_name_length",
      sql`char_length(btrim(${table.name})) between 1 and 100`,
    ),
    check("team_key_format", sql`${table.key} ~ '^[A-Z][A-Z0-9]{1,9}$'`),
    check(
      "team_description_length",
      sql`char_length(${table.description}) <= 2000`,
    ),
    check("team_version_positive", sql`${table.version} > 0`),
  ],
);
export const teamMember = pgTable(
  "team_member",
  {
    organisationId: uuid("organisation_id").notNull(),
    teamId: uuid("team_id").notNull(),
    userId: uuid("user_id").notNull(),
    role: teamRole("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    primaryKey({ columns: [table.organisationId, table.teamId, table.userId] }),
    foreignKey({
      name: "team_member_team_fk",
      columns: [table.organisationId, table.teamId],
      foreignColumns: [team.organisationId, team.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "team_member_organisation_member_fk",
      columns: [table.organisationId, table.userId],
      foreignColumns: [
        organisationMember.organisationId,
        organisationMember.userId,
      ],
    }).onDelete("cascade"),
    index("team_member_user_idx").on(
      table.organisationId,
      table.userId,
      table.teamId,
    ),
  ],
);
