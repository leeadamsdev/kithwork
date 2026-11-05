import type { organisationsSchema } from "@kithwork/database";
import type { OrganisationRole } from "@kithwork/contracts";

export type OrganisationRow =
  typeof organisationsSchema.organisation.$inferSelect & {
    role: OrganisationRole;
  };

export type MemberRow = {
  userId: string;
  name: string;
  role: OrganisationRole;
  joinedAt: Date;
};

export const summary = (row: OrganisationRow) => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

export const memberSummary = (row: MemberRow) => ({
  ...row,
  joinedAt: row.joinedAt.toISOString(),
});
