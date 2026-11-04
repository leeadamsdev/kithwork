import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export async function initializeEnvironment(
  source: string,
  target: string,
): Promise<boolean> {
  try {
    const content = (await readFile(source, "utf8")).replace(
      /^(AUTH_SECRET|MAIL_ENCRYPTION_KEY)=\r?$/gm,
      (_match, name: string) => `${name}=${randomBytes(32).toString("base64")}`,
    );
    await writeFile(target, content, { flag: "wx", mode: 0o600 });
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST")
      return false;
    throw error;
  }
}

if (import.meta.main) {
  const created = await initializeEnvironment(
    fileURLToPath(new URL("../.env.example", import.meta.url)),
    fileURLToPath(new URL("../.env", import.meta.url)),
  );
  console.log(
    created ? "Created .env from .env.example" : "Existing .env preserved",
  );
}
