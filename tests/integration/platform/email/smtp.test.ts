import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createSmtpDelivery } from "@kithwork/email/worker";
import { integrationServices } from "../../context.js";
import { fixture, cleanups } from "./fixtures.js";
describe("email smtp", () => {
  it("delivers real SMTP messages with HTML, text and stable identity to Mailpit", async () => {
    const services = integrationServices();
    const smtp = createSmtpDelivery({
      host: services.smtpHost,
      port: services.smtpPort,
      secure: false,
      requireTLS: false,
      from: "Kithwork <no-reply@kithwork.test>",
    });
    cleanups.push(smtp.close);
    const { producer, queue } = await fixture(smtp.deliver);
    for (const kind of [
      "verification",
      "password-reset",
      "invitation",
    ] as const) {
      const id = randomUUID();
      const to = `${id}@example.test`;
      const url = `https://example.test/action?token=${id}`;
      const common = { to, url, expiresAt: Date.now() + 60000 };
      await producer.enqueue(
        kind === "invitation"
          ? { ...common, kind, organisationName: "Software team" }
          : { ...common, kind },
        { id },
      );
      let found: { messages: { ID: string }[] } = { messages: [] };
      await expect
        .poll(async () => {
          const response = await fetch(
            `${services.mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`,
          );
          expect(response.ok).toBe(true);
          found = (await response.json()) as typeof found;
          return found.messages.length;
        })
        .toBe(1);
      const response = await fetch(
        `${services.mailpitUrl}/api/v1/message/${found.messages[0]!.ID}`,
      );
      const email = (await response.json()) as {
        HTML: string;
        Text: string;
        MessageID: string;
      };
      expect(email.Text).toContain(url);
      expect(email.HTML).toContain(id);
      expect(email.MessageID).toContain(id);
      await expect
        .poll(async () => (await queue.getJob(id))?.getState())
        .toBe("completed");
    }
  });
});
