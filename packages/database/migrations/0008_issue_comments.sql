CREATE TYPE "public"."issue_comment_event_kind" AS ENUM('created', 'edited', 'deleted');--> statement-breakpoint
CREATE TABLE "issue_comment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"author_id" uuid,
	"author_name" text NOT NULL,
	"body" text,
	"version" integer DEFAULT 1 NOT NULL,
	"creation_key" uuid NOT NULL,
	"creation_hash" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp (3) with time zone,
	"deleted_at" timestamp (3) with time zone,
	CONSTRAINT "issue_comment_scope_unique" UNIQUE("organisation_id","issue_id","id"),
	CONSTRAINT "issue_comment_creation_unique" UNIQUE("organisation_id","issue_id","author_id","creation_key"),
	CONSTRAINT "issue_comment_version_positive" CHECK ("issue_comment"."version">0),
	CONSTRAINT "issue_comment_creation_hash" CHECK ("issue_comment"."creation_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "issue_comment_body_length" CHECK (char_length(btrim("issue_comment"."body")) between 1 and 20000 and char_length("issue_comment"."body") <= 20000),
	CONSTRAINT "issue_comment_deleted_body" CHECK (("issue_comment"."deleted_at" is null and "issue_comment"."body" is not null) or ("issue_comment"."deleted_at" is not null and "issue_comment"."body" is null))
);
--> statement-breakpoint
CREATE TABLE "issue_comment_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"comment_id" uuid NOT NULL,
	"comment_version" integer NOT NULL,
	"kind" "issue_comment_event_kind" NOT NULL,
	"actor_id" uuid,
	"actor_name" text NOT NULL,
	"request_id" uuid,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issue_comment_event_version_unique" UNIQUE("organisation_id","issue_id","comment_id","comment_version"),
	CONSTRAINT "issue_comment_event_version_positive" CHECK ("issue_comment_event"."comment_version">0)
);
--> statement-breakpoint
ALTER TABLE "issue_comment" ADD CONSTRAINT "issue_comment_author_id_auth_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."auth_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_comment" ADD CONSTRAINT "issue_comment_issue_fk" FOREIGN KEY ("organisation_id","issue_id") REFERENCES "public"."issue"("organisation_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_comment_event" ADD CONSTRAINT "issue_comment_event_actor_id_auth_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."auth_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_comment_event" ADD CONSTRAINT "issue_comment_event_comment_fk" FOREIGN KEY ("organisation_id","issue_id","comment_id") REFERENCES "public"."issue_comment"("organisation_id","issue_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issue_comment_created_idx" ON "issue_comment" USING btree ("organisation_id","issue_id","created_at","id");