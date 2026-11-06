ALTER TYPE "public"."issue_activity_kind" ADD VALUE 'assignment_cleared';--> statement-breakpoint
ALTER TABLE "issue_activity" DROP CONSTRAINT "issue_activity_cause";--> statement-breakpoint
ALTER TABLE "issue" ADD COLUMN "assignee_id" uuid;--> statement-breakpoint
ALTER TABLE "issue" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "issue_assignee_member_fk" FOREIGN KEY ("organisation_id","assignee_id") REFERENCES "public"."organisation_member"("organisation_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "issue_project_team_fk" FOREIGN KEY ("organisation_id","project_id","team_id") REFERENCES "public"."project_team"("organisation_id","project_id","team_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issue_assignee_created_idx" ON "issue" USING btree ("organisation_id","assignee_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "issue"."assignee_id" is not null;--> statement-breakpoint
CREATE INDEX "issue_project_created_idx" ON "issue" USING btree ("organisation_id","project_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "issue"."project_id" is not null;--> statement-breakpoint
ALTER TABLE "issue_activity" ADD CONSTRAINT "issue_activity_cause" CHECK ("issue_activity"."cause" in ('user','organisation_member_removed','organisation_member_left','team_member_removed','team_member_left','team_visibility_changed','organisation_role_changed'));