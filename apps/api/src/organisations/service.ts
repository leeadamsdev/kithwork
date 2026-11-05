import {
  authSchema,
  organisationsSchema,
  type createDatabase,
} from "@kithwork/database";
import type { OrganisationRole } from "@kithwork/contracts";
import { and, eq, gt, ne, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  canChangeMemberRole,
  canRemoveMember,
  canUpdateOrganisation,
} from "./policies.js";
import { databaseErrorCode } from "../database-error.js";

type Database = ReturnType<typeof createDatabase>["db"];
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
const { organisation, organisationMember } = organisationsSchema;
const { user } = authSchema;
type OrganisationRow = typeof organisation.$inferSelect & {
  role: OrganisationRole;
};
type PageInput = { cursor?: string | undefined; limit: number };
type MemberRow = {
  userId: string;
  name: string;
  role: OrganisationRole;
  joinedAt: Date;
};
const summary = (row: OrganisationRow) => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});
const memberSummary = (row: MemberRow) => ({
  ...row,
  joinedAt: row.joinedAt.toISOString(),
});
function page<T>(rows: T[], limit: number, id: (row: T) => string) {
  const items = rows.slice(0, limit);
  return { items, nextCursor: rows.length > limit ? id(items.at(-1)!) : null };
}
const missing = () =>
  new TRPCError({
    code: "NOT_FOUND",
    message: "Organisation or membership not found",
  });
const forbidden = () =>
  new TRPCError({
    code: "FORBIDDEN",
    message: "Insufficient organisation permissions",
  });

export async function loadOrganisationAccess(
  db: Database | Transaction,
  actorId: string,
  organisationId: string,
) {
  const [row] = await db
    .select({
      id: organisation.id,
      name: organisation.name,
      createdAt: organisation.createdAt,
      updatedAt: organisation.updatedAt,
      role: organisationMember.role,
    })
    .from(organisation)
    .innerJoin(
      organisationMember,
      eq(organisationMember.organisationId, organisation.id),
    )
    .where(
      and(
        eq(organisation.id, organisationId),
        eq(organisationMember.userId, actorId),
      ),
    );
  if (!row) throw missing();
  return summary(row);
}

export async function createOrganisation(
  db: Database,
  actorId: string,
  name: string,
) {
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(organisation).values({ name }).returning();
    await tx
      .insert(organisationMember)
      .values({ organisationId: row!.id, userId: actorId, role: "owner" });
    return summary({ ...row!, role: "owner" });
  });
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
        input.cursor ? gt(organisationMember.userId, input.cursor) : undefined,
      ),
    )
    .orderBy(organisationMember.userId)
    .limit(input.limit + 1);
  return page(rows.map(memberSummary), input.limit, (row) => row.userId);
}

async function withLockedOrganisation<T>(
  db: Database,
  actorId: string,
  organisationId: string,
  action: (
    tx: Transaction,
    access: Awaited<ReturnType<typeof loadOrganisationAccess>>,
  ) => Promise<T>,
) {
  return db
    .transaction(
      async (tx) => {
        await tx.execute(sql`set local lock_timeout = '2s'`);
        await tx.execute(sql`set local statement_timeout = '5s'`);
        // Serialize organisation administration, then re-read permissions after waiting.
        // Every membership writer must take this lock before changing membership rows.
        const [row] = await tx
          .select({ id: organisation.id })
          .from(organisation)
          .where(eq(organisation.id, organisationId))
          .for("update");
        if (!row) throw missing();
        const access = await loadOrganisationAccess(
          tx,
          actorId,
          organisationId,
        );
        return action(tx, access);
      },
      { isolationLevel: "read committed" },
    )
    .catch((error: unknown) => {
      if (databaseErrorCode(error) === "55P03")
        throw new TRPCError({
          code: "CONFLICT",
          message: "Organisation is busy; retry your request",
        });
      throw error;
    });
}

export async function updateOrganisation(
  db: Database,
  actorId: string,
  organisationId: string,
  name: string,
) {
  return withLockedOrganisation(
    db,
    actorId,
    organisationId,
    async (tx, access) => {
      if (!canUpdateOrganisation(access.role)) throw forbidden();
      const [row] = await tx
        .update(organisation)
        .set({ name })
        .where(eq(organisation.id, organisationId))
        .returning();
      return summary({ ...row!, role: access.role });
    },
  );
}

async function targetMember(
  tx: Transaction,
  organisationId: string,
  userId: string,
) {
  const [row] = await tx
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
        eq(organisationMember.userId, userId),
      ),
    );
  if (!row) throw missing();
  return row;
}

async function preserveOwner(
  tx: Transaction,
  organisationId: string,
  target: MemberRow,
) {
  if (target.role !== "owner") return;
  const [other] = await tx
    .select({ userId: organisationMember.userId })
    .from(organisationMember)
    .where(
      and(
        eq(organisationMember.organisationId, organisationId),
        eq(organisationMember.role, "owner"),
        ne(organisationMember.userId, target.userId),
      ),
    )
    .limit(1);
  if (!other)
    throw new TRPCError({
      code: "CONFLICT",
      message: "Appoint another owner before removing the last owner",
    });
}

export async function changeMemberRole(
  db: Database,
  actorId: string,
  organisationId: string,
  userId: string,
  role: OrganisationRole,
) {
  return withLockedOrganisation(
    db,
    actorId,
    organisationId,
    async (tx, access) => {
      if (!canChangeMemberRole(access.role)) throw forbidden();
      const target = await targetMember(tx, organisationId, userId);
      if (role !== "owner") await preserveOwner(tx, organisationId, target);
      await tx
        .update(organisationMember)
        .set({ role })
        .where(
          and(
            eq(organisationMember.organisationId, organisationId),
            eq(organisationMember.userId, userId),
          ),
        );
      return memberSummary({ ...target, role });
    },
  );
}

export async function removeMember(
  db: Database,
  actorId: string,
  organisationId: string,
  userId: string,
  leaving = false,
) {
  return withLockedOrganisation(
    db,
    actorId,
    organisationId,
    async (tx, access) => {
      const target = await targetMember(tx, organisationId, userId);
      if (
        leaving
          ? actorId !== userId
          : !canRemoveMember(access.role, target.role)
      )
        throw forbidden();
      await preserveOwner(tx, organisationId, target);
      await tx
        .delete(organisationMember)
        .where(
          and(
            eq(organisationMember.organisationId, organisationId),
            eq(organisationMember.userId, userId),
          ),
        );
      return { success: true as const };
    },
  );
}
