CREATE TABLE "subscription_payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_payment_id" text,
	"amount_cents" bigint NOT NULL,
	"status" text NOT NULL,
	"due_date" date NOT NULL,
	"paid_at" timestamp with time zone,
	"period_start" date,
	"period_end" date,
	"invoice_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "billing_cycle" text DEFAULT 'MONTHLY' NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "price_cents" bigint;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "past_due_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "canceled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "checkout_url" text;--> statement-breakpoint
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_payments_provider_unique" ON "subscription_payments" USING btree ("provider","provider_payment_id");--> statement-breakpoint
CREATE INDEX "subscription_payments_org_idx" ON "subscription_payments" USING btree ("organization_id","due_date");--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_cycle_check" CHECK ("subscriptions"."billing_cycle" in ('MONTHLY', 'YEARLY'));