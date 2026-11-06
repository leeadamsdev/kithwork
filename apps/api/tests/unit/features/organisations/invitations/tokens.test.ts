import { expect, it } from "vitest";
import {
  createInvitationToken,
  matchesInvitationToken,
} from "../../../../../src/features/organisations/invitations/tokens.js";

it("creates independent opaque tokens and compares only their SHA-256 hashes", () => {
  const first = createInvitationToken();
  const second = createInvitationToken();
  expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(first.hash).toMatch(/^[a-f0-9]{64}$/);
  expect(first.token).not.toBe(second.token);
  expect(first.hash).not.toContain(first.token);
  expect(matchesInvitationToken(first.token, first.hash)).toBe(true);
  expect(matchesInvitationToken(second.token, first.hash)).toBe(false);
});
