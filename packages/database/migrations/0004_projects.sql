CREATE TYPE "public"."project_status" AS ENUM('planned', 'active', 'paused', 'completed', 'cancelled');--> statement-breakpoint
CREATE TABLE "project" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" "project_status" DEFAULT 'planned' NOT NULL,
	"start_date" date,
	"target_date" date,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "project_organisation_id_unique" UNIQUE("organisation_id","id"),
	CONSTRAINT "project_name_length" CHECK (char_length(btrim("project"."name")) between 1 and 100),
	CONSTRAINT "project_description_length" CHECK (char_length("project"."description") <= 2000),
	CONSTRAINT "project_version_positive" CHECK ("project"."version" > 0),
	CONSTRAINT "project_date_order" CHECK ("project"."target_date" >= "project"."start_date")
);
--> statement-breakpoint
CREATE TABLE "project_team" (
	"organisation_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_team_organisation_id_project_id_team_id_pk" PRIMARY KEY("organisation_id","project_id","team_id")
);
--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_team" ADD CONSTRAINT "project_team_project_fk" FOREIGN KEY ("organisation_id","project_id") REFERENCES "public"."project"("organisation_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_team" ADD CONSTRAINT "project_team_team_fk" FOREIGN KEY ("organisation_id","team_id") REFERENCES "public"."team"("organisation_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_team_team_idx" ON "project_team" USING btree ("organisation_id","team_id","project_id");