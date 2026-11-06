import { randomUUID } from "node:crypto";
import { createLogger } from "@kithwork/logging";
import { describe, expect, it } from "vitest";
import { createApi } from "../../../../../src/app.js";
import { useInvitationFixture } from "./fixtures.js";

describe("invitation request budgets", () => {
  const { fixture: f, invite } = useInvitationFixture();

  it("counts each batched send across API instances and organisations", async () => {
    const org = await f.create();
    const other = await f.create();
    const options = f.config({ API_INVITATION_SEND_RATE_LIMIT_MAX: "2" });
    const first = createApi({
      config: options,
      logger: createLogger("silent"),
    });
    const second = createApi({
      config: options,
      logger: createLogger("silent"),
    });
    try {
      await Promise.all([first.ready(), second.ready()]);
      const input = (organisationId: string) => ({
        organisationId,
        email: `${randomUUID()}@example.test`,
        role: "member",
      });
      expect(
        (
          await f.mutate(
            "organisations.invitations.create",
            input(org.id),
            f.alice,
            first,
          )
        ).statusCode,
      ).toBe(200);
      const response = await second.inject({
        method: "POST",
        url: "/trpc/organisations.invitations.create,organisations.invitations.create?batch=1",
        headers: { origin: f.webOrigin, cookie: f.alice.cookie },
        payload: { 0: input(other.id), 1: input(other.id) },
      });
      expect(response.statusCode, response.body).toBe(207);
      const results =
        response.json<
          { result?: unknown; error?: { data: { httpStatus: number } } }[]
        >();
      expect(results.filter((item) => item.result)).toHaveLength(1);
      expect(results.find((item) => item.error)?.error?.data.httpStatus).toBe(
        429,
      );
      expect(
        (
          await f.mutate(
            "organisations.invitations.create",
            input(org.id),
            f.alice,
            first,
          )
        ).statusCode,
      ).toBe(429);
    } finally {
      await Promise.all([first.close(), second.close()]);
    }
  });

  it("shares the organisation budget between administrators without letting members consume it", async () => {
    const org = await f.create();
    await f.member(org, f.bob, "admin");
    await f.member(org, f.carol);
    const instance = createApi({
      config: f.config({ API_INVITATION_SEND_RATE_LIMIT_MAX: "1" }),
      logger: createLogger("silent"),
    });
    const input = () => ({
      organisationId: org.id,
      email: `${randomUUID()}@example.test`,
      role: "member",
    });
    try {
      await instance.ready();
      expect(
        (
          await f.mutate(
            "organisations.invitations.create",
            input(),
            f.carol,
            instance,
          )
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await f.mutate(
            "organisations.invitations.create",
            input(),
            f.alice,
            instance,
          )
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await f.mutate(
            "organisations.invitations.create",
            input(),
            f.bob,
            instance,
          )
        ).statusCode,
      ).toBe(429);
      const independent = await f.create(f.bob);
      expect(
        (
          await f.mutate(
            "organisations.invitations.create",
            { ...input(), organisationId: independent.id },
            f.bob,
            instance,
          )
        ).statusCode,
      ).toBe(429);
    } finally {
      await instance.close();
    }
  });

  it("shares a recipient budget across preview and acceptance without affecting other accounts", async () => {
    const org = await f.create();
    const invitation = await invite(org, { email: f.bob.email });
    const options = f.config({ API_INVITATION_ACCESS_RATE_LIMIT_MAX: "1" });
    const first = createApi({
      config: options,
      logger: createLogger("silent"),
    });
    const second = createApi({
      config: options,
      logger: createLogger("silent"),
    });
    try {
      await Promise.all([first.ready(), second.ready()]);
      expect(
        (
          await f.query(
            "organisations.invitations.preview",
            { invitationId: invitation.id },
            f.bob,
            first,
          )
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await f.mutate(
            "organisations.invitations.accept",
            { invitationId: invitation.id, token: "a".repeat(43) },
            f.bob,
            second,
          )
        ).statusCode,
      ).toBe(429);
      expect(
        (
          await f.query(
            "organisations.invitations.preview",
            { invitationId: invitation.id },
            f.carol,
            second,
          )
        ).statusCode,
      ).toBe(404);
      expect(
        (
          await f.database.pool.query(
            "SELECT user_id FROM organisation_member WHERE organisation_id=$1 AND user_id=$2",
            [org.id, f.bob.id],
          )
        ).rowCount,
      ).toBe(0);
    } finally {
      await Promise.all([first.close(), second.close()]);
    }
  });
});
