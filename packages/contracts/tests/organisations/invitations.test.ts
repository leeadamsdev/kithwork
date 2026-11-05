import { describe, expect, it } from "vitest";
import {
  invitationRoleSchema,
  createInvitationInputSchema,
  acceptInvitationInputSchema,
  invitationSchema,
} from "../../src/organisations/invitations.js";

const id = "34ed1baa-b416-43a4-a10d-f8d1db37f380";
describe("organisation invitation contracts", () => {
  it("permits member/admin grants, normalises recipients and rejects unknown fields", () => {
    expect(invitationRoleSchema.options).toEqual(["member", "admin"]);
    expect(invitationRoleSchema.safeParse("owner").success).toBe(false);
    expect(
      createInvitationInputSchema.parse({
        organisationId: id,
        email: "  Lee+work@EXAMPLE.test  ",
        role: "member",
      }).email,
    ).toBe("lee+work@example.test");
    expect(
      createInvitationInputSchema.safeParse({
        organisationId: id,
        email: "a@example.test",
        role: "owner",
      }).success,
    ).toBe(false);
    expect(
      createInvitationInputSchema.safeParse({
        organisationId: id,
        email: "a@example.test",
        role: "member",
        token: "supplied",
      }).success,
    ).toBe(false);
  });
  it("requires an opaque token and invitation id for acceptance", () => {
    expect(
      acceptInvitationInputSchema.parse({
        invitationId: id,
        token: "a".repeat(43),
      }).token,
    ).toHaveLength(43);
    for (const token of [
      "",
      "a".repeat(42),
      "a".repeat(44),
      "a".repeat(42) + "+",
    ])
      expect(
        acceptInvitationInputSchema.safeParse({ invitationId: id, token })
          .success,
      ).toBe(false);
  });
  it("does not allow secrets in administrative invitation responses", () => {
    const invitation = {
      id,
      organisationId: id,
      email: "a@example.test",
      role: "member",
      issuerId: id,
      status: "pending",
      createdAt: "2026-11-05T00:00:00.000Z",
      expiresAt: "2026-11-12T00:00:00.000Z",
      resendAvailableAt: "2026-11-05T00:01:00.000Z",
      emailStatus: "pending",
    };
    expect(invitationSchema.parse(invitation)).toEqual(invitation);
    expect(
      invitationSchema.safeParse({ ...invitation, token: "secret" }).success,
    ).toBe(false);
    expect(
      invitationSchema.safeParse({ ...invitation, tokenHash: "secret" })
        .success,
    ).toBe(false);
  });
});
