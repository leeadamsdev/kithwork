CREATE TYPE "public"."organisation_role" AS ENUM('owner', 'admin', 'member');--> statement-breakpoint
CREATE TABLE "organisation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organisation_name_length" CHECK (char_length(btrim("organisation"."name")) between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "organisation_member" (
	"organisation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "organisation_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organisation_member_organisation_id_user_id_pk" PRIMARY KEY("organisation_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "organisation_member" ADD CONSTRAINT "organisation_member_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisation_member" ADD CONSTRAINT "organisation_member_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organisation_member_user_idx" ON "organisation_member" USING btree ("user_id","organisation_id");--> statement-breakpoint
CREATE INDEX "organisation_member_role_idx" ON "organisation_member" USING btree ("organisation_id","role");