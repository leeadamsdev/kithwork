import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  sealMessage,
  openMessage,
  parseEncryptionKey,
} from "../../src/crypto.js";
import { emailMessageSchema } from "../../src/message.js";
const key = randomBytes(32);
const message = {
  kind: "verification" as const,
  to: "lee@example.test",
  url: "https://example.test/verify?token=secret-marker",
  expiresAt: Date.now() + 60_000,
};
describe("email crypto", () => {
  it("binds persisted mail to its outbox id without changing legacy encryption", () => {
    const sealed = sealMessage(message, key, "outbox-one");
    expect(openMessage(sealed, key, "outbox-one")).toEqual(message);
    expect(() => openMessage(sealed, key, "outbox-two")).toThrow(
      "Invalid email payload",
    );
    expect(() => openMessage(sealed, key)).toThrow("Invalid email payload");
    expect(openMessage(sealMessage(message, key), key)).toEqual(message);
  });
  it("encrypts recipient and bearer links with independent nonces", () => {
    const first = sealMessage(message, key);
    expect(first).not.toEqual(sealMessage(message, key));
    expect(JSON.stringify(first)).not.toContain("secret-marker");
    expect(JSON.stringify(first)).not.toContain(message.to);
    expect(openMessage(first, key)).toEqual(message);
  });
  it.each([
    { encoding: "UTF-8", character: "\u6f22" },
    { encoding: "JSON-escaped", character: "\u0001" },
  ])(
    "round-trips schema-sized $encoding invitation payloads",
    ({ character }) => {
      const prefix = "https://example.test/";
      const input = emailMessageSchema.parse({
        ...message,
        kind: "invitation",
        to: `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(61)}`,
        url: prefix + character.repeat(4096 - prefix.length - 1) + "x",
        organisationName: character.repeat(100),
      });
      expect(openMessage(sealMessage(input, key), key)).toEqual(input);
    },
  );
  it("rejects tampering, malformed envelopes and the wrong key", () => {
    const sealed = sealMessage(message, key);
    expect(() =>
      openMessage({ ...sealed, expiresAt: sealed.expiresAt + 1 }, key),
    ).toThrow("Invalid email payload");
    expect(() => openMessage(sealed, randomBytes(32))).toThrow(
      "Invalid email payload",
    );
    expect(() => openMessage({ ...sealed, version: 2 }, key)).toThrow(
      "Invalid email payload",
    );
    expect(() => parseEncryptionKey("bad")).toThrow(
      "Invalid email encryption key",
    );
    expect(parseEncryptionKey(key.toString("base64"))).toEqual(key);
  });
});
