import { expect, it } from "vitest";
import { startWorker } from "../worker/fixtures.js";

it("runs publication and durable SMTP delivery in the compiled worker service", async () => {
  const worker = await startWorker();
  try {
    const event = await worker.database.event();
    await expect
      .poll(
        async () =>
          (
            await worker.database.pool.query<{ outcome: string | null }>(
              "SELECT outcome FROM email_outbox WHERE id=$1",
              [event.id],
            )
          ).rows[0]?.outcome,
        { timeout: 8000 },
      )
      .toBe("sent");
    expect(worker.output()).toContain(event.id);
    expect(worker.output()).toContain(event.requestId);
    expect(worker.output()).not.toContain(event.message.to);
    expect(worker.output()).not.toContain(event.message.url);
    expect(worker.stderr()).toBe("");
  } finally {
    await worker.close();
  }
}, 15000);
