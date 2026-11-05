import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";
import {
  emailMessageMaxLengths,
  emailMessageSchema,
  type EmailMessage,
} from "./message.js";

// JSON needs at most six bytes per string code unit; reserve 128 bytes for
// the fixed keys, kind and numeric expiry, then include base64 expansion.
const maxJsonBytes =
  6 *
    Object.values(emailMessageMaxLengths).reduce(
      (sum, length) => sum + length,
      0,
    ) +
  128;
const maxEncodedMessageLength = 4 * Math.ceil(maxJsonBytes / 3);

const envelopeSchema = z.object({
  version: z.literal(1),
  expiresAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  iv: z.base64().length(16),
  tag: z.base64().length(24),
  data: z.base64().max(maxEncodedMessageLength),
});
export type SealedMessage = z.infer<typeof envelopeSchema>;

export function parseEncryptionKey(value: string): Buffer {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(value))
    throw new Error("Invalid email encryption key");
  const key = Buffer.from(value, "base64");
  if (key.length !== 32 || key.toString("base64") !== value)
    throw new Error("Invalid email encryption key");
  return key;
}

function aad(expiresAt: number, context?: string) {
  return Buffer.from(
    `kithwork:email:v1:${expiresAt}${context ? `:${context}` : ""}`,
  );
}
export function sealMessage(
  message: EmailMessage,
  key: Buffer,
  context?: string,
): SealedMessage {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad(message.expiresAt, context));
  const data = Buffer.concat([
    cipher.update(JSON.stringify(message), "utf8"),
    cipher.final(),
  ]);
  return {
    version: 1,
    expiresAt: message.expiresAt,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  };
}
export function openMessage(
  value: unknown,
  key: Buffer,
  context?: string,
): EmailMessage {
  try {
    const envelope = envelopeSchema.parse(value);
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(envelope.iv, "base64"),
    );
    decipher.setAAD(aad(envelope.expiresAt, context));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    const text = Buffer.concat([
      decipher.update(Buffer.from(envelope.data, "base64")),
      decipher.final(),
    ]).toString("utf8");
    const message = emailMessageSchema.parse(JSON.parse(text) as unknown);
    if (message.expiresAt !== envelope.expiresAt)
      throw new Error("Expiry mismatch");
    return message;
  } catch {
    // Cipher and validation errors can include supplied payloads; never propagate them.
    throw new Error("Invalid email payload");
  }
}
