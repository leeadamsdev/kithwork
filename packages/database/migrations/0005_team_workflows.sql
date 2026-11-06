CREATE TYPE "public"."workflow_category" AS ENUM('backlog', 'unstarted', 'started', 'completed', 'cancelled');--> statement-breakpoint
CREATE TABLE "team_workflow" (
	"organisation_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_workflow_organisation_id_team_id_pk" PRIMARY KEY("organisation_id","team_id"),
	CONSTRAINT "team_workflow_version_positive" CHECK ("team_workflow"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "workflow_status" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" "workflow_category" NOT NULL,
	"position" integer NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone,
	CONSTRAINT "workflow_status_team_id_unique" UNIQUE("organisation_id","team_id","id"),
	CONSTRAINT "workflow_status_name_length" CHECK (char_length(btrim("workflow_status"."name")) between 1 and 50),
	CONSTRAINT "workflow_status_description_length" CHECK (char_length("workflow_status"."description") <= 500),
	CONSTRAINT "workflow_status_position_nonnegative" CHECK ("workflow_status"."position" >= 0),
	CONSTRAINT "workflow_status_default_active_category" CHECK (not "workflow_status"."is_default" or ("workflow_status"."retired_at" is null and "workflow_status"."category" in ('backlog','unstarted')))
);
--> statement-breakpoint
ALTER TABLE "team_workflow" ADD CONSTRAINT "team_workflow_team_fk" FOREIGN KEY ("organisation_id","team_id") REFERENCES "public"."team"("organisation_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_status" ADD CONSTRAINT "workflow_status_workflow_fk" FOREIGN KEY ("organisation_id","team_id") REFERENCES "public"."team_workflow"("organisation_id","team_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_status_name_unique" ON "workflow_status" USING btree ("organisation_id","team_id",lower(btrim("name")));--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_status_default_unique" ON "workflow_status" USING btree ("organisation_id","team_id") WHERE "workflow_status"."is_default";
--> statement-breakpoint
INSERT INTO "team_workflow" ("organisation_id", "team_id")
SELECT "organisation_id", "id" FROM "team";
--> statement-breakpoint
INSERT INTO "workflow_status" ("organisation_id", "team_id", "name", "category", "position", "is_default")
SELECT w."organisation_id", w."team_id", defaults.name, defaults.category::"workflow_category", 0, defaults.is_default
FROM "team_workflow" w
CROSS JOIN (VALUES
  ('Backlog', 'backlog', true),
  ('Todo', 'unstarted', false),
  ('In Progress', 'started', false),
  ('Done', 'completed', false),
  ('Cancelled', 'cancelled', false)
) AS defaults(name, category, is_default);
