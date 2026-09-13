CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"work_order_id" uuid,
	"customer_id" uuid NOT NULL,
	"financial_entry_id" uuid,
	"method" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"installments" smallint DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'CONFIRMED' NOT NULL,
	"paid_at" timestamp with time zone NOT NULL,
	"provider" text,
	"provider_payment_id" text,
	"notes" text,
	"canceled_at" timestamp with time zone,
	"canceled_by" uuid,
	"cancel_reason" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "payments_method_check" CHECK ("payments"."method" in ('PIX','CASH','DEBIT_CARD','CREDIT_CARD','BOLETO','BANK_TRANSFER','OTHER')),
	CONSTRAINT "payments_status_check" CHECK ("payments"."status" in ('CONFIRMED','CANCELED')),
	CONSTRAINT "payments_amount_check" CHECK ("payments"."amount_cents" > 0),
	CONSTRAINT "payments_installments_check" CHECK ("payments"."installments" >= 1),
	CONSTRAINT "payments_cancel_reason_check" CHECK ("payments"."canceled_at" is null or "payments"."cancel_reason" is not null),
	CONSTRAINT "payments_canceled_consistency_check" CHECK ("payments"."status" <> 'CANCELED' or "payments"."canceled_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_canceled_by_users_id_fk" FOREIGN KEY ("canceled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_work_order_fk" FOREIGN KEY ("organization_id","work_order_id") REFERENCES "public"."work_orders"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "public"."customers"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payments_work_order_idx" ON "payments" USING btree ("organization_id","work_order_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "payments_customer_idx" ON "payments" USING btree ("organization_id","customer_id","created_at" DESC NULLS LAST);