CREATE TYPE "public"."issue_priority" AS ENUM('none', 'urgent', 'high', 'normal', 'low');--> statement-breakpoint
CREATE TYPE "public"."issue_activity_kind" AS ENUM('created', 'updated', 'archived', 'restored');--> statement-breakpoint
CREATE TABLE "issue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status_id" uuid NOT NULL,
	"priority" "issue_priority" DEFAULT 'none' NOT NULL,
	"due_date" date,
	"version" integer DEFAULT 1 NOT NULL,
	"creator_id" uuid,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp (3) with time zone,
	CONSTRAINT "issue_organisation_id_unique" UNIQUE("organisation_id","id"),
	CONSTRAINT "issue_team_number_unique" UNIQUE("organisation_id","team_id","number"),
	CONSTRAINT "issue_title_length" CHECK (char_length(btrim("issue"."title")) between 1 and 200),
	CONSTRAINT "issue_description_length" CHECK (char_length("issue"."description") <= 20000),
	CONSTRAINT "issue_number_positive" CHECK ("issue"."number" > 0),
	CONSTRAINT "issue_version_positive" CHECK ("issue"."version" > 0),
	CONSTRAINT "issue_due_date_range" CHECK ("issue"."due_date" between date '0001-01-01' and date '9999-12-31')
);
--> statement-breakpoint
CREATE TABLE "issue_counter" (
	"organisation_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "issue_counter_organisation_id_team_id_pk" PRIMARY KEY("organisation_id","team_id"),
	CONSTRAINT "issue_counter_number_nonnegative" CHECK ("issue_counter"."last_number" >= 0)
);
--> statement-breakpoint
CREATE TABLE "issue_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"issue_version" integer NOT NULL,
	"actor_id" uuid,
	"actor_name" text NOT NULL,
	"kind" "issue_activity_kind" NOT NULL,
	"cause" text NOT NULL,
	"changes" jsonb NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issue_activity_version_unique" UNIQUE("organisation_id","issue_id","issue_version"),
	CONSTRAINT "issue_activity_version_positive" CHECK ("issue_activity"."issue_version" > 0),
	CONSTRAINT "issue_activity_cause" CHECK ("issue_activity"."cause" = 'user'),
	CONSTRAINT "issue_activity_changes_object" CHECK (jsonb_typeof("issue_activity"."changes") = 'object')
);
--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "issue_creator_id_auth_user_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."auth_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "issue_team_fk" FOREIGN KEY ("organisation_id","team_id") REFERENCES "public"."team"("organisation_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "issue_status_fk" FOREIGN KEY ("organisation_id","team_id","status_id") REFERENCES "public"."workflow_status"("organisation_id","team_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_counter" ADD CONSTRAINT "issue_counter_team_fk" FOREIGN KEY ("organisation_id","team_id") REFERENCES "public"."team"("organisation_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_activity" ADD CONSTRAINT "issue_activity_actor_id_auth_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."auth_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_activity" ADD CONSTRAINT "issue_activity_issue_fk" FOREIGN KEY ("organisation_id","issue_id") REFERENCES "public"."issue"("organisation_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issue_organisation_created_idx" ON "issue" USING btree ("organisation_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "issue_team_created_idx" ON "issue" USING btree ("organisation_id","team_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);