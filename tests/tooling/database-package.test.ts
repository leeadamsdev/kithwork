import { createDatabase } from "@kithwork/database";
import { expect, it } from "vitest";

it("loads the compiled database package and leaves connection ownership with the caller", async () => {
  const errors: Error[] = [];
  const { db, pool } = createDatabase({
    connectionString: "postgres://unused:unused@127.0.0.1:1/unused",
    onPoolError: (error) => {
      errors.push(error);
    },
  });
  expect(db).toBeDefined();
  expect(pool.totalCount).toBe(0);
  await pool.end();
  expect(errors).toEqual([]);
});
