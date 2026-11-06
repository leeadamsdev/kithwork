CREATE TYPE "public"."team_role" AS ENUM('maintainer', 'member');--> statement-breakpoint
CREATE TYPE "public"."team_visibility" AS ENUM('organisation', 'private');--> statement-breakpoint
CREATE TABLE "team" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"key" text NOT NULL,
	"description" text,
	"visibility" "team_visibility" DEFAULT 'organisation' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "team_organisation_id_unique" UNIQUE("organisation_id","id"),
	CONSTRAINT "team_organisation_key_unique" UNIQUE("organisation_id","key"),
	CONSTRAINT "team_name_length" CHECK (char_length(btrim("team"."name")) between 1 and 100),
	CONSTRAINT "team_key_format" CHECK ("team"."key" ~ '^[A-Z][A-Z0-9]{1,9}$'),
	CONSTRAINT "team_description_length" CHECK (char_length("team"."description") <= 2000),
	CONSTRAINT "team_version_positive" CHECK ("team"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "team_member" (
	"organisation_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "team_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_member_organisation_id_team_id_user_id_pk" PRIMARY KEY("organisation_id","team_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "team" ADD CONSTRAINT "team_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member" ADD CONSTRAINT "team_member_team_fk" FOREIGN KEY ("organisation_id","team_id") REFERENCES "public"."team"("organisation_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member" ADD CONSTRAINT "team_member_organisation_member_fk" FOREIGN KEY ("organisation_id","user_id") REFERENCES "public"."organisation_member"("organisation_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "team_member_user_idx" ON "team_member" USING btree ("organisation_id","user_id","team_id");