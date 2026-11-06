import { createServer, type Socket } from "node:net";
import { once } from "node:events";
import { expect, it } from "vitest";
import { startWorker } from "./fixtures.js";

it("cleans its isolated queue after a forcibly stopped worker leaves an active email", async () => {
  const sockets = new Set<Socket>();
  const smtp = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  smtp.listen(0, "127.0.0.1");
  await once(smtp, "listening");
  const address = smtp.address();
  if (!address || typeof address === "string")
    throw new Error("Missing SMTP listener");
  let worker: Awaited<ReturnType<typeof startWorker>> | undefined;
  try {
    worker = await startWorker({ host: "127.0.0.1", port: address.port });
    await worker.database.event();
    const running = worker;
    await expect
      .poll(async () => (await running.queue.getJobCounts("active")).active, {
        timeout: 8000,
      })
      .toBe(1);
    running.child.kill("SIGKILL");
    await running.exited;
    worker = undefined;
    // The process is gone, so its owned queue must be removable even with an abandoned active job.
    await running.close();
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) =>
      smtp.close((error) => (error ? reject(error) : resolve())),
    );
    await worker?.close();
  }
}, 15000);
