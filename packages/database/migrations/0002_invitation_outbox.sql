CREATE TYPE "public"."invitation_status" AS ENUM('pending', 'accepted', 'revoked', 'expired');--> statement-breakpoint
CREATE TABLE "organisation_invitation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "organisation_role" NOT NULL,
	"issuer_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"token_hash" text NOT NULL,
	"status" "invitation_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_by" uuid,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organisation_invitation_role" CHECK ("organisation_invitation"."role" in ('member','admin')),
	CONSTRAINT "organisation_invitation_email" CHECK ("organisation_invitation"."email" = lower(btrim("organisation_invitation"."email")) and char_length("organisation_invitation"."email") between 3 and 254),
	CONSTRAINT "organisation_invitation_token_hash" CHECK ("organisation_invitation"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "organisation_invitation_version" CHECK ("organisation_invitation"."version" > 0),
	CONSTRAINT "organisation_invitation_acceptance" CHECK (("organisation_invitation"."status" = 'accepted' and "organisation_invitation"."accepted_by" is not null and "organisation_invitation"."accepted_at" is not null) or ("organisation_invitation"."status" <> 'accepted' and "organisation_invitation"."accepted_by" is null and "organisation_invitation"."accepted_at" is null))
);
--> statement-breakpoint
CREATE TABLE "email_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text DEFAULT 'organisation.invitation_email.v1' NOT NULL,
	"invitation_id" uuid NOT NULL,
	"invitation_version" integer NOT NULL,
	"payload" jsonb,
	"request_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"next_publish_at" timestamp with time zone DEFAULT now() NOT NULL,
	"publish_lease_id" uuid,
	"publish_lease_until" timestamp with time zone,
	"publication_attempts" integer DEFAULT 0 NOT NULL,
	"last_published_at" timestamp with time zone,
	"delivery_lease_id" uuid,
	"delivery_lease_until" timestamp with time zone,
	"delivery_attempts" integer DEFAULT 0 NOT NULL,
	"outcome" text,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "email_outbox_type" CHECK ("email_outbox"."type" = 'organisation.invitation_email.v1'),
	CONSTRAINT "email_outbox_version" CHECK ("email_outbox"."invitation_version" > 0),
	CONSTRAINT "email_outbox_attempts" CHECK ("email_outbox"."publication_attempts" >= 0 and "email_outbox"."delivery_attempts" between 0 and 5),
	CONSTRAINT "email_outbox_outcome" CHECK ("email_outbox"."outcome" is null or "email_outbox"."outcome" in ('sent','skipped','failed')),
	CONSTRAINT "email_outbox_completion" CHECK (("email_outbox"."completed_at" is null and "email_outbox"."outcome" is null and "email_outbox"."payload" is not null) or ("email_outbox"."completed_at" is not null and "email_outbox"."outcome" is not null and "email_outbox"."payload" is null)),
	CONSTRAINT "email_outbox_publication_lease" CHECK (("email_outbox"."publish_lease_id" is null) = ("email_outbox"."publish_lease_until" is null)),
	CONSTRAINT "email_outbox_delivery_lease" CHECK (("email_outbox"."delivery_lease_id" is null) = ("email_outbox"."delivery_lease_until" is null))
);
--> statement-breakpoint
ALTER TABLE "organisation_invitation" ADD CONSTRAINT "organisation_invitation_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisation_invitation" ADD CONSTRAINT "organisation_invitation_issuer_id_auth_user_id_fk" FOREIGN KEY ("issuer_id") REFERENCES "public"."auth_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisation_invitation" ADD CONSTRAINT "organisation_invitation_accepted_by_auth_user_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."auth_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_invitation_id_organisation_invitation_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."organisation_invitation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "organisation_invitation_pending_recipient_unique" ON "organisation_invitation" USING btree ("organisation_id","email") WHERE "organisation_invitation"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "organisation_invitation_org_idx" ON "organisation_invitation" USING btree ("organisation_id","id");--> statement-breakpoint
CREATE INDEX "organisation_invitation_issuer_idx" ON "organisation_invitation" USING btree ("organisation_id","issuer_id") WHERE "organisation_invitation"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "organisation_invitation_expiry_idx" ON "organisation_invitation" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "email_outbox_invitation_version_unique" ON "email_outbox" USING btree ("invitation_id","invitation_version");--> statement-breakpoint
CREATE INDEX "email_outbox_ready_idx" ON "email_outbox" USING btree ("next_publish_at","id") WHERE "email_outbox"."completed_at" is null;--> statement-breakpoint
CREATE INDEX "email_outbox_retention_idx" ON "email_outbox" USING btree ("completed_at") WHERE "email_outbox"."completed_at" is not null;