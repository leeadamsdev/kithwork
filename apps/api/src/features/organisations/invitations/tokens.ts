import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function createInvitationToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: createHash("sha256").update(token).digest("hex") };
}

export function matchesInvitationToken(token: string, storedHash: string) {
  return timingSafeEqual(
    createHash("sha256").update(token).digest(),
    Buffer.from(storedHash, "hex"),
  );
}
