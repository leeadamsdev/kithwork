import { fileURLToPath } from "node:url";
import { z } from "zod";
import { migrateDatabase } from "./migrate.js";

try {
  process.loadEnvFile(new URL("../../../.env", import.meta.url));
} catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
    throw error;
}

const url = z
  .url({ protocol: /^postgres(ql)?$/ })
  .safeParse(process.env.DATABASE_URL);
if (!url.success) {
  console.error("Invalid migration configuration: DATABASE_URL");
  process.exitCode = 1;
} else {
  try {
    await migrateDatabase({
      connectionString: url.data,
      migrationsFolder: fileURLToPath(
        new URL("../migrations/", import.meta.url),
      ),
      onPoolError: () => console.error("Migration database connection failed"),
    });
    console.log("Database migrations applied");
  } catch {
    console.error("Database migration failed");
    process.exitCode = 1;
  }
}
