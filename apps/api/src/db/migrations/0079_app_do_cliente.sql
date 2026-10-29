-- App do cliente (E50): o link por cliente. Só o hash do token fica no banco.

ALTER TABLE "customers" ADD COLUMN "portal_token_hash" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "portal_token_issued_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "customers_portal_token_unique" ON "customers" USING btree ("portal_token_hash") WHERE portal_token_hash is not null;