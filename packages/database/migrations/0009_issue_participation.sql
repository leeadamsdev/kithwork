CREATE TYPE "public"."issue_subscription_state" AS ENUM('watching', 'muted');--> statement-breakpoint
CREATE TABLE "issue_comment_mention" (
	"organisation_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"comment_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"first_mentioned_version" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "issue_comment_mention_pk" PRIMARY KEY("organisation_id","issue_id","comment_id","user_id"),
	CONSTRAINT "issue_comment_mention_version_positive" CHECK ("issue_comment_mention"."first_mentioned_version">0)
);
--> statement-breakpoint
CREATE TABLE "issue_subscription" (
	"organisation_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"state" "issue_subscription_state" NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issue_subscription_organisation_id_issue_id_user_id_pk" PRIMARY KEY("organisation_id","issue_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "issue_comment" ADD COLUMN "mentions_initialised" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "issue_comment_mention" ADD CONSTRAINT "issue_comment_mention_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_comment_mention" ADD CONSTRAINT "issue_comment_mention_comment_fk" FOREIGN KEY ("organisation_id","issue_id","comment_id") REFERENCES "public"."issue_comment"("organisation_id","issue_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_subscription" ADD CONSTRAINT "issue_subscription_issue_fk" FOREIGN KEY ("organisation_id","issue_id") REFERENCES "public"."issue"("organisation_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_subscription" ADD CONSTRAINT "issue_subscription_member_fk" FOREIGN KEY ("organisation_id","user_id") REFERENCES "public"."organisation_member"("organisation_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issue_comment_mention_user_idx" ON "issue_comment_mention" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "issue_subscription_member_idx" ON "issue_subscription" USING btree ("organisation_id","user_id","issue_id");
--> statement-breakpoint
-- Existing participation is followed once; ordinary historical Markdown links stay uninitialised.
WITH participants AS (
  SELECT organisation_id, id AS issue_id, creator_id AS user_id FROM issue WHERE creator_id IS NOT NULL
  UNION
  SELECT organisation_id, id, assignee_id FROM issue WHERE assignee_id IS NOT NULL
  UNION
  SELECT organisation_id, issue_id, author_id FROM issue_comment WHERE deleted_at IS NULL AND author_id IS NOT NULL
)
INSERT INTO issue_subscription (organisation_id, issue_id, user_id, state)
SELECT p.organisation_id, p.issue_id, p.user_id, 'watching'
FROM participants p
INNER JOIN issue i ON i.organisation_id=p.organisation_id AND i.id=p.issue_id
INNER JOIN team t ON t.organisation_id=i.organisation_id AND t.id=i.team_id
INNER JOIN organisation_member m ON m.organisation_id=p.organisation_id AND m.user_id=p.user_id
LEFT JOIN team_member tm ON tm.organisation_id=t.organisation_id AND tm.team_id=t.id AND tm.user_id=p.user_id
WHERE m.role IN ('owner','admin') OR t.visibility='organisation' OR tm.user_id IS NOT NULL
ON CONFLICT DO NOTHING;
