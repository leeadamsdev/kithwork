import { issueSubscriptionStates } from "@kithwork/contracts";
import {
  foreignKey,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { issue } from "./issues.js";
import { organisationMember } from "./organisations.js";

export const issueSubscriptionState = pgEnum(
  "issue_subscription_state",
  issueSubscriptionStates,
);
export const issueSubscription = pgTable(
  "issue_subscription",
  {
    organisationId: uuid("organisation_id").notNull(),
    issueId: uuid("issue_id").notNull(),
    userId: uuid("user_id").notNull(),
    state: issueSubscriptionState("state").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.organisationId, table.issueId, table.userId],
    }),
    foreignKey({
      name: "issue_subscription_issue_fk",
      columns: [table.organisationId, table.issueId],
      foreignColumns: [issue.organisationId, issue.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "issue_subscription_member_fk",
      columns: [table.organisationId, table.userId],
      foreignColumns: [
        organisationMember.organisationId,
        organisationMember.userId,
      ],
    }).onDelete("cascade"),
    index("issue_subscription_member_idx").on(
      table.organisationId,
      table.userId,
      table.issueId,
    ),
  ],
);
