import { expect, it, vi } from "vitest";
import * as memberQueries from "../../../../src/features/organisations/queries.js";
import * as invitationQueries from "../../../../src/features/organisations/invitations/queries.js";
import { useInvitationFixture } from "./invitations/fixtures.js";

const { fixture: f, invite } = useInvitationFixture();

it("does not return the directory when organisation access is revoked after middleware authorisation", async () => {
  const org = await f.create();
  await f.member(org, f.bob);
  const release = Promise.withResolvers<void>();
  let waiting = false;
  const original = memberQueries.listMembers;
  // Delay execution only; the resumed query still uses real PostgreSQL and its actual predicates.
  const gate = vi
    .spyOn(memberQueries, "listMembers")
    .mockImplementationOnce(async (...args) => {
      waiting = true;
      await release.promise;
      return original(...args);
    });
  const pending = f.query(
    "organisations.members.list",
    { organisationId: org.id },
    f.bob,
  );
  try {
    await expect.poll(() => waiting).toBe(true);
    const removed = await f.mutate(
      "organisations.members.remove",
      { organisationId: org.id, userId: f.bob.id },
      f.alice,
    );
    expect(removed.statusCode).toBe(200);
    release.resolve();
    const response = await pending;
    expect(response.statusCode, response.body).toBe(200);
    expect(
      f.data<{ items: unknown[]; nextCursor: string | null }>(response),
    ).toEqual({ items: [], nextCursor: null });
  } finally {
    release.resolve();
    await pending;
    gate.mockRestore();
  }
});

it.each(["demotion", "removal"])(
  "does not expose invitations after administrator %s between authorisation and the data query",
  async (mode) => {
    const org = await f.create();
    await f.member(org, f.bob, "admin");
    await invite(org);
    const release = Promise.withResolvers<void>();
    let waiting = false;
    const original = invitationQueries.listInvitations;
    const gate = vi
      .spyOn(invitationQueries, "listInvitations")
      .mockImplementationOnce(async (...args) => {
        waiting = true;
        await release.promise;
        return original(...args);
      });
    const pending = f.query(
      "organisations.invitations.list",
      { organisationId: org.id },
      f.bob,
    );
    try {
      await expect.poll(() => waiting).toBe(true);
      const changed = await f.mutate(
        mode === "demotion"
          ? "organisations.members.changeRole"
          : "organisations.members.remove",
        {
          organisationId: org.id,
          userId: f.bob.id,
          ...(mode === "demotion" ? { role: "member" } : {}),
        },
        f.alice,
      );
      expect(changed.statusCode).toBe(200);
      release.resolve();
      const response = await pending;
      expect(response.statusCode, response.body).toBe(200);
      expect(
        f.data<{ items: unknown[]; nextCursor: string | null }>(response),
      ).toEqual({ items: [], nextCursor: null });
    } finally {
      release.resolve();
      await pending;
      gate.mockRestore();
    }
  },
);
