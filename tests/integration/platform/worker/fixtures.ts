import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Queue } from "bullmq";
import { expect } from "vitest";
import { createEmailProducer } from "@kithwork/email";
import { integrationServices } from "../../context.js";
import { uniqueNamespace } from "../../support/namespace.js";
import { outboxDatabase } from "../outbox/fixtures.js";

export async function startWorker(smtp?: { host: string; port: number }) {
  const services = integrationServices();
  const database = await outboxDatabase();
  const encryptionKey = database.key.toString("base64");
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
        new URL("../../../../apps/worker/dist/index.js", import.meta.url),
      ),
    ],
    {
      env: {
        ...process.env,
        NODE_ENV: "test",
        DATABASE_URL: database.connectionString,
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
      await database.close();
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
    database,
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
