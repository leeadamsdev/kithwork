import { describe, expect, it } from "vitest";
import { emailMessageSchema } from "../../src/message.js";

const message = {
  kind: "verification" as const,
  to: "lee@example.test",
  url: "https://example.test/verify?token=secret-marker",
  expiresAt: Date.now() + 60_000,
};
describe("email schema", () => {
  it("rejects invalid recipients, unsafe link protocols and oversized names", () => {
    expect(
      emailMessageSchema.safeParse({
        ...message,
        to: "bad\r\nBcc: victim@example.test",
      }).success,
    ).toBe(false);
    expect(
      emailMessageSchema.safeParse({ ...message, url: "javascript:alert(1)" })
        .success,
    ).toBe(false);
    expect(
      emailMessageSchema.safeParse({
        ...message,
        kind: "invitation",
        organisationName: "x".repeat(101),
      }).success,
    ).toBe(false);
  });
});
