import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer, type Socket } from "node:net";
import { fileURLToPath } from "node:url";
import { Queue } from "bullmq";
import { expect, it } from "vitest";
import { createEmailProducer } from "@kithwork/email";
import { integrationServices } from "./context.js";
import { uniqueNamespace } from "./fixtures.js";

async function startWorker(smtp?: { host: string; port: number }) {
  const services = integrationServices();
  const encryptionKey = randomBytes(32).toString("base64");
  const prefix = uniqueNamespace();
  const queue = new Queue<unknown>("email", {
    connection: { url: services.redisUrl },
    prefix,
  });
  const producer = await createEmailProducer({
    redisUrl: services.redisUrl,
    encryptionKey,
    prefix,
    onError: () => {},
  });
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(
        new URL("../../apps/worker/dist/index.js", import.meta.url),
      ),
    ],
    {
      env: {
        ...process.env,
        NODE_ENV: "test",
        LOG_LEVEL: "info",
        REDIS_URL: services.redisUrl,
        MAIL_ENCRYPTION_KEY: encryptionKey,
        EMAIL_QUEUE_PREFIX: prefix,
        SMTP_HOST: smtp?.host ?? services.smtpHost,
        SMTP_PORT: String(smtp?.port ?? services.smtpPort),
        SMTP_SECURE: "false",
        SMTP_REQUIRE_TLS: "false",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  let output = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => {
    output = (output + chunk.toString()).slice(-64000);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const exited = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  const close = async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await exited;
    await producer.close();
    try {
      await queue.obliterate();
    } finally {
      await queue.close();
    }
  };
  try {
    await expect
      .poll(
        () => {
          if (child.exitCode !== null || child.signalCode !== null)
            throw new Error(`Worker exited: ${stderr}`);
          return output;
        },
        { timeout: 8000 },
      )
      .toContain("Email worker ready");
  } catch (error) {
    await close();
    throw error;
  }
  return {
    child,
    producer,
    queue,
    encryptionKey,
    exited,
    close,
    output: () => output,
    stderr: () => stderr,
  };
}

it("runs the compiled worker with real SMTP and correlates sanitized job logs", async () => {
  const worker = await startWorker();
  try {
    const id = randomUUID();
    const requestId = randomUUID();
    await worker.producer.enqueue(
      {
        kind: "verification",
        to: `${id}@example.test`,
        url: "https://example.test/verify?token=secret-link-marker",
        expiresAt: Date.now() + 60000,
      },
      { id, requestId },
    );
    await expect
      .poll(async () => (await worker.queue.getJob(id))?.getState())
      .toBe("completed");
    await expect.poll(worker.output).toContain(requestId);
    expect(worker.output()).toContain(id);
    expect(worker.output()).not.toMatch(
      /secret-link-marker|verification.*example\.test/,
    );
    expect(worker.output()).not.toContain(worker.encryptionKey);
    worker.child.kill("SIGTERM");
    const result = await worker.exited;
    if (process.platform !== "win32")
      expect(result).toEqual({ code: 0, signal: null });
    expect(worker.stderr()).toBe("");
  } finally {
    await worker.close();
  }
}, 15000);

it(
  "drains an active SMTP exchange before exiting on native SIGTERM",
  { skip: process.platform === "win32", timeout: 15000 },
  async () => {
    const received = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const sockets = new Set<Socket>();
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      socket.on("error", () => socket.destroy());
      socket.setEncoding("utf8");
      socket.write("220 localhost test SMTP\r\n");
      let input = "";
      let data = false;
      socket.on("data", (chunk: string) => {
        input += chunk;
        while (true) {
          if (data) {
            const end = input.indexOf("\r\n.\r\n");
            if (end < 0) return;
            input = input.slice(end + 5);
            data = false;
            received.resolve();
            void release.promise.then(() => {
              socket.write("250 accepted\r\n");
            });
            return;
          }
          const end = input.indexOf("\r\n");
          if (end < 0) return;
          const line = input.slice(0, end);
          input = input.slice(end + 2);
          if (line.startsWith("EHLO"))
            socket.write("250-localhost\r\n250 PIPELINING\r\n");
          else if (line === "DATA") {
            data = true;
            socket.write("354 Send data\r\n");
          } else if (line === "QUIT") socket.end("221 Bye\r\n");
          else socket.write("250 OK\r\n");
        }
      });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing SMTP address");
    let worker: Awaited<ReturnType<typeof startWorker>> | undefined;
    try {
      worker = await startWorker({ host: "127.0.0.1", port: address.port });
      const id = randomUUID();
      await worker.producer.enqueue(
        {
          kind: "verification",
          to: "drain@example.test",
          url: "https://example.test/verify",
          expiresAt: Date.now() + 60000,
        },
        { id },
      );
      await received.promise;
      worker.child.kill("SIGTERM");
      await expect.poll(worker.output).toContain("Email worker stopping");
      expect(worker.child.exitCode).toBeNull();
      expect(await (await worker.queue.getJob(id))?.getState()).toBe("active");
      release.resolve();
      expect(await worker.exited).toEqual({ code: 0, signal: null });
      expect(await (await worker.queue.getJob(id))?.getState()).toBe(
        "completed",
      );
      expect(worker.stderr()).toBe("");
    } finally {
      release.resolve();
      await worker?.close();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);
