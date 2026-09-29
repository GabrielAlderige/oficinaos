CREATE TABLE "commission_payouts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"mechanic_user_id" uuid NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"amount_cents" bigint NOT NULL,
	"notes" text,
	"paid_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "commission_bps" integer;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "commission_bps" integer;--> statement-breakpoint
ALTER TABLE "work_order_items" ADD COLUMN "commission_bps" integer;--> statement-breakpoint
ALTER TABLE "work_order_items" ADD COLUMN "commission_user_id" uuid;--> statement-breakpoint
ALTER TABLE "commission_payouts" ADD CONSTRAINT "commission_payouts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_payouts" ADD CONSTRAINT "commission_payouts_mechanic_user_id_users_id_fk" FOREIGN KEY ("mechanic_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_payouts" ADD CONSTRAINT "commission_payouts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commission_payouts_mechanic_idx" ON "commission_payouts" USING btree ("organization_id","mechanic_user_id","paid_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "work_order_items" ADD CONSTRAINT "work_order_items_commission_user_id_users_id_fk" FOREIGN KEY ("commission_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;