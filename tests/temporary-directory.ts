import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function createTemporaryDirectory(
  prefix: string,
): Promise<string> {
  const root = join(tmpdir(), "Kithwork");
  await mkdir(root, { recursive: true });
  return mkdtemp(join(root, prefix));
}
