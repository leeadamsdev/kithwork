import { constants } from "node:fs";
import { copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export async function initializeEnvironment(
  source: string,
  target: string,
): Promise<boolean> {
  try {
    await copyFile(source, target, constants.COPYFILE_EXCL);
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
