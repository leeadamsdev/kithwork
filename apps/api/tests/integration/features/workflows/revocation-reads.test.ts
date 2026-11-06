import { expect, it, vi } from "vitest";
import * as access from "../../../../src/features/workflows/access.js";
import { useWorkflowFixture } from "./fixtures.js";

const { f, teams, query } = useWorkflowFixture();

it("rechecks organisation and private team access in the actual read, including empty pages", async () => {
  for (const mode of ["organisation", "private"] as const) {
    const org = await f.create();
    await f.member(org, f.bob);
    const team = await teams.create(org, { visibility: mode });
    const scope = { organisationId: org.id, teamId: team.id };
    if (mode === "private")
      await teams.mutate(
        "members.add",
        { ...scope, userId: f.bob.id },
        f.alice,
      );
    const release = Promise.withResolvers<void>();
    let waiting = false;
    const original = access.readWorkflowPage;
    const gate = vi
      .spyOn(access, "readWorkflowPage")
      .mockImplementationOnce(async (...args) => {
        waiting = true;
        await release.promise;
        return original(...args);
      });
    const pending = query(
      mode === "private" ? "statuses.list" : "get",
      { ...scope, ...(mode === "private" ? { retired: "only" } : {}) },
      f.bob,
    );
    try {
      await expect.poll(() => waiting).toBe(true);
      const response =
        mode === "private"
          ? await teams.mutate(
              "members.remove",
              { ...scope, userId: f.bob.id },
              f.alice,
            )
          : await f.mutate(
              "organisations.members.remove",
              { organisationId: org.id, userId: f.bob.id },
              f.alice,
            );
      expect(response.statusCode).toBe(200);
      release.resolve();
      expect((await pending).statusCode).toBe(404);
    } finally {
      release.resolve();
      await pending;
      gate.mockRestore();
    }
  }
});
