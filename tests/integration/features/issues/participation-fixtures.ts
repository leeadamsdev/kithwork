import { randomUUID } from "node:crypto";
import type { createTestDatabase } from "../../platform/database/fixtures.js";

export async function seedIssueParticipation(
  db: Awaited<ReturnType<typeof createTestDatabase>>,
) {
  const org = randomUUID(),
    otherOrg = randomUUID(),
    team = randomUUID(),
    status = randomUUID(),
    issue = randomUUID();
  const alice = randomUUID(),
    bob = randomUUID(),
    carol = randomUUID(),
    dave = randomUUID(),
    comment = randomUUID();
  await db.pool.query(
    "INSERT INTO auth_user(id,name,email) VALUES($1,'Alice','alice@example.test'),($2,'Bob','bob@example.test'),($3,'Carol','carol@example.test'),($4,'Dave','dave@example.test')",
    [alice, bob, carol, dave],
  );
  await db.pool.query(
    "INSERT INTO organisation(id,name) VALUES($1,'Main'),($2,'Other')",
    [org, otherOrg],
  );
  await db.pool.query(
    "INSERT INTO organisation_member(organisation_id,user_id,role) VALUES($1,$2,'owner'),($1,$3,'member'),($1,$4,'member'),($1,$5,'member')",
    [org, alice, bob, carol, dave],
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
    "INSERT INTO issue(id,organisation_id,team_id,number,title,status_id,creator_id,assignee_id) VALUES($1,$2,$3,1,'Existing',$4,$5,$6)",
    [issue, org, team, status, alice, bob],
  );
  await db.pool.query(
    "INSERT INTO issue_comment(id,organisation_id,issue_id,author_id,author_name,body,creation_key,creation_hash) VALUES($1,$2,$3,$4,'Carol','Existing body',$5,$6)",
    [comment, org, issue, carol, randomUUID(), "a".repeat(64)],
  );
  return {
    org,
    otherOrg,
    team,
    status,
    issue,
    alice,
    bob,
    carol,
    dave,
    comment,
  };
}
