import { describe, expect, it } from "vitest";
import { createLogger } from "@kithwork/logging";
import { createApi } from "../../../../src/app.js";
import { useOrganisationFixture } from "./fixtures.js";
describe("persistence", () => {
  const fixture = useOrganisationFixture();
  it("rolls back an organisation when owner insertion fails and keeps database details private", async () => {
    const marker = "private-organisation-database-marker";
    const logStart = fixture.logLines.length;
    await fixture.database.pool.query(
      `CREATE FUNCTION fail_org_membership() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION '${marker}'; END;$$; CREATE TRIGGER fail_org_membership BEFORE INSERT ON organisation_member FOR EACH ROW EXECUTE FUNCTION fail_org_membership()`,
    );
    try {
      const response = await fixture.mutate(
        "organisations.create",
        { name: "Rolled back organisation" },
        fixture.alice,
      );
      expect(response.statusCode).toBe(500);
      expect(response.body).not.toContain(marker);
      expect(
        (
          await fixture.database.pool.query(
            "SELECT id FROM organisation WHERE name='Rolled back organisation'",
          )
        ).rows,
      ).toEqual([]);
      const logs = fixture.logLines.slice(logStart).join("");
      expect(logs).toContain(response.headers["x-request-id"]);
      expect(logs).not.toContain(marker);
      expect(logs).not.toContain("insert into");
    } finally {
      await fixture.database.pool.query(
        "DROP TRIGGER fail_org_membership ON organisation_member; DROP FUNCTION fail_org_membership()",
      );
    }
  });
  it("requires the organisation migration before announcing readiness", async () => {
    await fixture.database.pool.query(
      "ALTER TABLE organisation RENAME TO unavailable_organisation",
    );
    const instance = createApi({
      config: fixture.config(),
      logger: createLogger("silent"),
    });
    try {
      await expect(instance.ready()).rejects.toMatchObject({ code: "42P01" });
    } finally {
      await instance.close();
      await fixture.database.pool.query(
        "ALTER TABLE unavailable_organisation RENAME TO organisation",
      );
    }
  });
});
