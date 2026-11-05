import { describe, expect, it } from "vitest";
import { renderEmail } from "../../src/delivery/render.js";

const message = {
  kind: "verification" as const,
  to: "lee@example.test",
  url: "https://example.test/verify?token=secret-marker",
  expiresAt: Date.now() + 60_000,
};
describe("email render", () => {
  it.each(["verification", "password-reset", "invitation"] as const)(
    "renders %s links in both HTML and text",
    async (kind) => {
      const input =
        kind === "invitation"
          ? { ...message, kind, organisationName: "<script>untrusted</script>" }
          : { ...message, kind };
      const output = await renderEmail(input);
      expect(output.text).toContain(message.url);
      expect(output.html).toContain("secret-marker");
      expect(output.html).not.toContain("<script>untrusted</script>");
      expect(output.subject).toBeTruthy();
    },
  );
});
