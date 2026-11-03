import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

export async function startApiProcess(
  env: Record<string, string>,
  fixture?: "drain" | "telemetry" | "telemetry-wire",
) {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const child = spawn(
    process.execPath,
    [fixture ? `tests/fixtures/${fixture}-server.ts` : "dist/index.js"],
    {
      cwd: root,
      env: {
        ...process.env,
        NODE_ENV: "test",
        OTEL_SDK_DISABLED: "true",
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
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
  const waitFor = async (text: string) => {
    const deadline = Date.now() + 8000;
    while (!stdout.includes(text)) {
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error(`API exited before ${text}: ${stdout} ${stderr}`);
      if (Date.now() >= deadline)
        throw new Error(`Timed out waiting for ${text}: ${stdout} ${stderr}`);
      await delay(20);
    }
  };
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await exited;
  };
  try {
    await waitFor("API ready");
    const line = stdout
      .split("\n")
      .find((line) => line.includes('"msg":"API ready"'))!;
    const { address } = JSON.parse(line) as { address: string };
    return {
      process: child,
      address,
      exited,
      stop,
      waitFor,
      stdout: () => stdout,
      stderr: () => stderr,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}
