import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
export function createServiceLogs(logDirectory: string, password: string) {
  const logs = new Map<string, string>();
  const capture = (name: string) => (stream: NodeJS.ReadableStream) => {
    stream.on("data", (chunk: Buffer) => {
      logs.set(
        name,
        ((logs.get(name) ?? "") + chunk.toString()).slice(-64_000),
      );
    });
  };

  return {
    capture,
    async save() {
      await mkdir(logDirectory, { recursive: true });
      await Promise.all(
        [...logs].map(([name, contents]) =>
          writeFile(
            resolve(logDirectory, `${name}.log`),
            contents.replaceAll(password, "[redacted]"),
          ),
        ),
      );
    },
  };
}
