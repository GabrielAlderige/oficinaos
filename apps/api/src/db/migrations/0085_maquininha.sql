CREATE TABLE "pos_charges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"work_order_id" uuid,
	"counter_sale_id" uuid,
	"method" text NOT NULL,
	"installments" integer DEFAULT 1 NOT NULL,
	"amount_cents" bigint NOT NULL,
	"device_serial" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"environment" text NOT NULL,
	"provider" text NOT NULL,
	"client_request_id" uuid NOT NULL,
	"provider_order_id" text,
	"provider_charge_id" text,
	"paid_amount_cents" bigint,
	"paid_at" timestamp with time zone,
	"card_brand" text,
	"authorization_code" text,
	"settlement_ref" uuid,
	"failure_reason" text,
	"canceled_at" timestamp with time zone,
	"provider_response" jsonb,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "pos_charges_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "pos_charges_origin_check" CHECK (("pos_charges"."work_order_id" is null) <> ("pos_charges"."counter_sale_id" is null)),
	CONSTRAINT "pos_charges_method_check" CHECK ("pos_charges"."method" in ('CREDIT_CARD','DEBIT_CARD','PIX')),
	CONSTRAINT "pos_charges_status_check" CHECK ("pos_charges"."status" in ('PENDING','PAID','CANCELED','FAILED','REFUNDED')),
	CONSTRAINT "pos_charges_amount_check" CHECK ("pos_charges"."amount_cents" > 0),
	CONSTRAINT "pos_charges_installments_check" CHECK ("pos_charges"."installments" between 1 and 12),
	CONSTRAINT "pos_charges_paid_check" CHECK ("pos_charges"."status" not in ('PAID', 'REFUNDED') or ("pos_charges"."paid_at" is not null and "pos_charges"."settlement_ref" is not null))
);
--> statement-breakpoint
CREATE TABLE "pos_settings" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'simulador' NOT NULL,
	"secret_key_enc" text,
	"key_hint" text,
	"devices" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "pos_charges" ADD CONSTRAINT "pos_charges_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_charges" ADD CONSTRAINT "pos_charges_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_charges" ADD CONSTRAINT "pos_charges_work_order_fk" FOREIGN KEY ("organization_id","work_order_id") REFERENCES "public"."work_orders"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_charges" ADD CONSTRAINT "pos_charges_counter_sale_fk" FOREIGN KEY ("organization_id","counter_sale_id") REFERENCES "public"."counter_sales"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_settings" ADD CONSTRAINT "pos_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_settings" ADD CONSTRAINT "pos_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pos_charges_client_request_unique" ON "pos_charges" USING btree ("organization_id","client_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pos_charges_provider_order_unique" ON "pos_charges" USING btree ("provider","provider_order_id");--> statement-breakpoint
CREATE INDEX "pos_charges_work_order_idx" ON "pos_charges" USING btree ("organization_id","work_order_id");--> statement-breakpoint
CREATE INDEX "pos_charges_counter_sale_idx" ON "pos_charges" USING btree ("organization_id","counter_sale_id");