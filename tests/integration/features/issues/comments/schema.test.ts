import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { createTestDatabase } from "../../../platform/database/fixtures.js";

it("enforces scoped comment/event identities, deletion state and body-free metadata while retaining departed authors", async () => {
  const db = await createTestDatabase({ migrate: true });
  try {
    const org = randomUUID(),
      other = randomUUID(),
      team = randomUUID(),
      user = randomUUID(),
      issue = randomUUID(),
      status = randomUUID(),
      comment = randomUUID();
    await db.pool.query(
      "INSERT INTO auth_user(id,name,email) VALUES($1,'Author','author@example.test')",
      [user],
    );
    await db.pool.query(
      "INSERT INTO organisation(id,name) VALUES($1,'First'),($2,'Other')",
      [org, other],
    );
    await db.pool.query(
      "INSERT INTO organisation_member(organisation_id,user_id,role) VALUES($1,$2,'owner')",
      [org, user],
    );
    await db.pool.query(
      "INSERT INTO team(id,organisation_id,name,key) VALUES($1,$2,'Team','ENG')",
      [team, org],
    );
    await db.pool.query(
      "INSERT INTO team_workflow(organisation_id,team_id) VALUES($1,$2)",
      [org, team],
    );
    await db.pool.query(
      "INSERT INTO workflow_status(id,organisation_id,team_id,name,category,position,is_default) VALUES($1,$2,$3,'Backlog','backlog',0,true)",
      [status, org, team],
    );
    await db.pool.query(
      "INSERT INTO issue(id,organisation_id,team_id,number,title,status_id) VALUES($1,$2,$3,1,'Existing',$4)",
      [issue, org, team, status],
    );
    const values = [comment, org, issue, user, randomUUID(), "a".repeat(64)];
    const insert =
      "INSERT INTO issue_comment(id,organisation_id,issue_id,author_id,author_name,creation_key,creation_hash,body) VALUES($1,$2,$3,$4,'Author',$5,$6,'Body')";
    await expect(
      db.pool.query(insert, [
        randomUUID(),
        other,
        issue,
        user,
        randomUUID(),
        "a".repeat(64),
      ]),
    ).rejects.toMatchObject({ code: "23503" });
    await db.pool.query(insert, values);
    await expect(
      db.pool.query(insert, [randomUUID(), ...values.slice(1)]),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(
      db.pool.query("UPDATE issue_comment SET body=null WHERE id=$1", [
        comment,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      db.pool.query("UPDATE issue_comment SET deleted_at=now() WHERE id=$1", [
        comment,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      db.pool.query(
        "UPDATE issue_comment SET body=repeat('x',20001) WHERE id=$1",
        [comment],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await db.pool.query(
      "INSERT INTO issue_comment_event(organisation_id,issue_id,comment_id,comment_version,actor_id,actor_name,kind,request_id) VALUES($1,$2,$3,1,$4,'Author','created',$5)",
      [org, issue, comment, user, randomUUID()],
    );
    await expect(
      db.pool.query(
        "INSERT INTO issue_comment_event(organisation_id,issue_id,comment_id,comment_version,actor_name,kind) VALUES($1,$2,$3,2,'Author','edited')",
        [other, issue, comment],
      ),
    ).rejects.toMatchObject({ code: "23503" });
    await db.pool.query(
      "DELETE FROM organisation_member WHERE organisation_id=$1 AND user_id=$2",
      [org, user],
    );
    expect(
      (
        await db.pool.query(
          "SELECT author_id,body FROM issue_comment WHERE id=$1",
          [comment],
        )
      ).rows,
    ).toEqual([{ author_id: user, body: "Body" }]);
    await db.pool.query(
      "UPDATE issue_comment SET body=null,deleted_at=now(),version=2 WHERE id=$1",
      [comment],
    );
    expect(
      (
        await db.pool.query<{ column_name: string }>(
          "SELECT column_name FROM information_schema.columns WHERE table_name='issue_comment_event'",
        )
      ).rows.map((row) => row.column_name),
    ).not.toContain("body");
    await db.pool.query("DELETE FROM auth_user WHERE id=$1", [user]);
    expect(
      (
        await db.pool.query(
          "SELECT author_id,author_name,body FROM issue_comment WHERE id=$1",
          [comment],
        )
      ).rows,
    ).toEqual([{ author_id: null, author_name: "Author", body: null }]);
  } finally {
    await db.close();
  }
});
