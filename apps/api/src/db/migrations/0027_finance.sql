CREATE TABLE "financial_categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"name" text NOT NULL,
	"system_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "financial_categories_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "financial_categories_direction_check" CHECK ("financial_categories"."direction" in ('RECEIVABLE','PAYABLE'))
);
--> statement-breakpoint
CREATE TABLE "financial_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"origin" text DEFAULT 'MANUAL' NOT NULL,
	"category_id" uuid,
	"description" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"paid_cents" bigint DEFAULT 0 NOT NULL,
	"due_date" date NOT NULL,
	"customer_id" uuid,
	"supplier_id" uuid,
	"work_order_id" uuid,
	"purchase_order_id" uuid,
	"group_id" uuid,
	"installment_number" integer DEFAULT 1 NOT NULL,
	"installment_count" integer DEFAULT 1 NOT NULL,
	"notes" text,
	"settled_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"canceled_by" uuid,
	"cancel_reason" text,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "financial_entries_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "financial_entries_direction_check" CHECK ("financial_entries"."direction" in ('RECEIVABLE','PAYABLE')),
	CONSTRAINT "financial_entries_status_check" CHECK ("financial_entries"."status" in ('OPEN','PARTIAL','PAID','CANCELED')),
	CONSTRAINT "financial_entries_origin_check" CHECK ("financial_entries"."origin" in ('MANUAL','WORK_ORDER','PURCHASE')),
	CONSTRAINT "financial_entries_amount_check" CHECK ("financial_entries"."amount_cents" > 0),
	CONSTRAINT "financial_entries_paid_check" CHECK ("financial_entries"."paid_cents" >= 0 and "financial_entries"."paid_cents" <= "financial_entries"."amount_cents"),
	CONSTRAINT "financial_entries_installment_check" CHECK ("financial_entries"."installment_count" >= 1 and "financial_entries"."installment_number" between 1 and "financial_entries"."installment_count"),
	CONSTRAINT "financial_entries_origin_document_check" CHECK (("financial_entries"."origin" <> 'WORK_ORDER' or "financial_entries"."work_order_id" is not null) and ("financial_entries"."origin" <> 'PURCHASE' or "financial_entries"."purchase_order_id" is not null)),
	CONSTRAINT "financial_entries_canceled_check" CHECK (("financial_entries"."status" = 'CANCELED') = ("financial_entries"."canceled_at" is not null) and ("financial_entries"."canceled_at" is null or "financial_entries"."cancel_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "financial_settlements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"client_request_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	"method" text NOT NULL,
	"paid_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text,
	"status" text DEFAULT 'CONFIRMED' NOT NULL,
	"payment_id" uuid,
	"canceled_at" timestamp with time zone,
	"canceled_by" uuid,
	"cancel_reason" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "financial_settlements_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "financial_settlements_client_request_unique" UNIQUE("organization_id","client_request_id"),
	CONSTRAINT "financial_settlements_method_check" CHECK ("financial_settlements"."method" in ('PIX','CASH','DEBIT_CARD','CREDIT_CARD','BOLETO','BANK_TRANSFER','OTHER')),
	CONSTRAINT "financial_settlements_status_check" CHECK ("financial_settlements"."status" in ('CONFIRMED','CANCELED')),
	CONSTRAINT "financial_settlements_amount_check" CHECK ("financial_settlements"."amount_cents" > 0),
	CONSTRAINT "financial_settlements_canceled_check" CHECK (("financial_settlements"."status" = 'CANCELED') = ("financial_settlements"."canceled_at" is not null) and ("financial_settlements"."canceled_at" is null or "financial_settlements"."cancel_reason" is not null))
);
--> statement-breakpoint
ALTER TABLE "financial_categories" ADD CONSTRAINT "financial_categories_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_canceled_by_users_id_fk" FOREIGN KEY ("canceled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_category_fk" FOREIGN KEY ("organization_id","category_id") REFERENCES "public"."financial_categories"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_customer_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "public"."customers"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_supplier_fk" FOREIGN KEY ("organization_id","supplier_id") REFERENCES "public"."suppliers"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_work_order_fk" FOREIGN KEY ("organization_id","work_order_id") REFERENCES "public"."work_orders"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_purchase_order_fk" FOREIGN KEY ("organization_id","purchase_order_id") REFERENCES "public"."purchase_orders"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_settlements" ADD CONSTRAINT "financial_settlements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_settlements" ADD CONSTRAINT "financial_settlements_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_settlements" ADD CONSTRAINT "financial_settlements_canceled_by_users_id_fk" FOREIGN KEY ("canceled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_settlements" ADD CONSTRAINT "financial_settlements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_settlements" ADD CONSTRAINT "financial_settlements_entry_fk" FOREIGN KEY ("organization_id","entry_id") REFERENCES "public"."financial_entries"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "financial_categories_org_name_unique" ON "financial_categories" USING btree ("organization_id","direction",lower(name));--> statement-breakpoint
CREATE UNIQUE INDEX "financial_categories_org_key_unique" ON "financial_categories" USING btree ("organization_id","system_key") WHERE system_key is not null;--> statement-breakpoint
CREATE INDEX "financial_entries_due_idx" ON "financial_entries" USING btree ("organization_id","direction","status","due_date");--> statement-breakpoint
CREATE INDEX "financial_entries_work_order_idx" ON "financial_entries" USING btree ("organization_id","work_order_id");--> statement-breakpoint
CREATE INDEX "financial_entries_purchase_order_idx" ON "financial_entries" USING btree ("organization_id","purchase_order_id");--> statement-breakpoint
CREATE INDEX "financial_entries_customer_idx" ON "financial_entries" USING btree ("organization_id","customer_id","due_date");--> statement-breakpoint
CREATE INDEX "financial_entries_supplier_idx" ON "financial_entries" USING btree ("organization_id","supplier_id","due_date");--> statement-breakpoint
CREATE INDEX "financial_settlements_entry_idx" ON "financial_settlements" USING btree ("organization_id","entry_id","paid_at");--> statement-breakpoint
CREATE INDEX "financial_settlements_paid_idx" ON "financial_settlements" USING btree ("organization_id","paid_at");