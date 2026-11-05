import { organisationRoles } from "@kithwork/contracts";
import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth.js";

export const organisationRole = pgEnum("organisation_role", organisationRoles);
export const organisation = pgTable(
  "organisation",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    check(
      "organisation_name_length",
      sql`char_length(btrim(${table.name})) between 1 and 100`,
    ),
  ],
);

export const organisationMember = pgTable(
  "organisation_member",
  {
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisation.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    role: organisationRole("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.organisationId, table.userId] }),
    index("organisation_member_user_idx").on(
      table.userId,
      table.organisationId,
    ),
    index("organisation_member_role_idx").on(table.organisationId, table.role),
  ],
);
