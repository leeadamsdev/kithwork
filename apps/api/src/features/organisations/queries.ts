import { authSchema, organisationsSchema } from "@kithwork/database";
import { and, eq, exists, gt } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Database } from "../../platform/database/types.js";
import { summary, memberSummary } from "./presentation.js";
const { organisation, organisationMember } = organisationsSchema;
const { user } = authSchema;
const actorMembership = alias(organisationMember, "actor_membership");

type PageInput = { cursor?: string | undefined; limit: number };

function page<T>(rows: T[], limit: number, id: (row: T) => string) {
  const items = rows.slice(0, limit);
  return { items, nextCursor: rows.length > limit ? id(items.at(-1)!) : null };
}

export async function listOrganisations(
  db: Database,
  actorId: string,
  input: PageInput,
) {
  const rows = await db
    .select({
      id: organisation.id,
      name: organisation.name,
      createdAt: organisation.createdAt,
      updatedAt: organisation.updatedAt,
      role: organisationMember.role,
    })
    .from(organisationMember)
    .innerJoin(
      organisation,
      eq(organisation.id, organisationMember.organisationId),
    )
    .where(
      and(
        eq(organisationMember.userId, actorId),
        input.cursor
          ? gt(organisationMember.organisationId, input.cursor)
          : undefined,
      ),
    )
    .orderBy(organisationMember.organisationId)
    .limit(input.limit + 1);
  return page(rows.map(summary), input.limit, (row) => row.id);
}

export async function listMembers(
  db: Database,
  actorId: string,
  organisationId: string,
  input: PageInput,
) {
  const rows = await db
    .select({
      userId: user.id,
      name: user.name,
      role: organisationMember.role,
      joinedAt: organisationMember.createdAt,
    })
    .from(organisationMember)
    .innerJoin(user, eq(user.id, organisationMember.userId))
    .where(
      and(
        eq(organisationMember.organisationId, organisationId),
        exists(
          db
            .select({ userId: actorMembership.userId })
            .from(actorMembership)
            .where(
              and(
                eq(actorMembership.organisationId, organisationId),
                eq(actorMembership.userId, actorId),
              ),
            ),
        ),
        input.cursor ? gt(organisationMember.userId, input.cursor) : undefined,
      ),
    )
    .orderBy(organisationMember.userId)
    .limit(input.limit + 1);
  return page(rows.map(memberSummary), input.limit, (row) => row.userId);
}
