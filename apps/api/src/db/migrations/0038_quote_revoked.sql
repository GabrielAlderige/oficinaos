ALTER TABLE "quotes" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "revoke_reason" text;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_revoked_check" CHECK (("quotes"."status" = 'REVOKED') = ("quotes"."revoked_at" is not null) and ("quotes"."revoked_at" is null or "quotes"."revoke_reason" is not null));