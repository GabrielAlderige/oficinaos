CREATE TABLE "invoice_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"work_order_item_id" uuid,
	"description" text NOT NULL,
	"quantity" numeric(12, 3) NOT NULL,
	"unit_price_cents" bigint NOT NULL,
	"total_cents" bigint NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_items_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "invoice_items_quantity_check" CHECK ("invoice_items"."quantity" > 0),
	CONSTRAINT "invoice_items_money_check" CHECK ("invoice_items"."unit_price_cents" >= 0 and "invoice_items"."total_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" text DEFAULT 'NFSE' NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"environment" text NOT NULL,
	"provider" text,
	"work_order_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"vehicle_id" uuid,
	"rps_number" integer NOT NULL,
	"rps_series" text NOT NULL,
	"invoice_number" text,
	"verification_code" text,
	"provider_ref" text,
	"public_url" text,
	"pdf_url" text,
	"xml_url" text,
	"client_request_id" uuid NOT NULL,
	"service_amount_cents" bigint NOT NULL,
	"deductions_cents" bigint DEFAULT 0 NOT NULL,
	"discount_cents" bigint DEFAULT 0 NOT NULL,
	"base_amount_cents" bigint NOT NULL,
	"iss_rate_bps" integer NOT NULL,
	"iss_amount_cents" bigint NOT NULL,
	"iss_retained" boolean DEFAULT false NOT NULL,
	"irrf_cents" bigint DEFAULT 0 NOT NULL,
	"pis_cents" bigint DEFAULT 0 NOT NULL,
	"cofins_cents" bigint DEFAULT 0 NOT NULL,
	"csll_cents" bigint DEFAULT 0 NOT NULL,
	"inss_cents" bigint DEFAULT 0 NOT NULL,
	"total_cents" bigint NOT NULL,
	"net_cents" bigint NOT NULL,
	"description" text NOT NULL,
	"provider_response" jsonb,
	"rejection_reason" text,
	"issued_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"cancel_reason" text,
	"canceled_by" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "invoices_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "invoices_kind_check" CHECK ("invoices"."kind" in ('NFSE')),
	CONSTRAINT "invoices_status_check" CHECK ("invoices"."status" in ('DRAFT','QUEUED','AUTHORIZED','REJECTED','CANCELED')),
	CONSTRAINT "invoices_environment_check" CHECK ("invoices"."environment" in ('SIMULATOR','HOMOLOGATION','PRODUCTION')),
	CONSTRAINT "invoices_money_check" CHECK ("invoices"."total_cents" >= 0 and "invoices"."base_amount_cents" >= 0 and "invoices"."iss_amount_cents" >= 0),
	CONSTRAINT "invoices_rps_check" CHECK ("invoices"."rps_number" > 0),
	CONSTRAINT "invoices_canceled_check" CHECK (("invoices"."status" = 'CANCELED') = ("invoices"."canceled_at" is not null) and ("invoices"."canceled_at" is null or "invoices"."cancel_reason" is not null)),
	CONSTRAINT "invoices_authorized_check" CHECK ("invoices"."status" <> 'AUTHORIZED' or "invoices"."issued_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "organization_fiscal_settings" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"municipal_registration" text,
	"state_registration" text,
	"tax_regime" text,
	"cnae" text,
	"service_list_item" text,
	"municipal_service_code" text,
	"iss_rate_bps" integer,
	"iss_retained_default" boolean DEFAULT false NOT NULL,
	"rps_series" text DEFAULT '1' NOT NULL,
	"environment" text DEFAULT 'SIMULATOR' NOT NULL,
	"provider" text,
	"provider_company_id" text,
	"additional_information" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "org_fiscal_regime_check" CHECK ("organization_fiscal_settings"."tax_regime" is null or "organization_fiscal_settings"."tax_regime" in ('MEI','SIMPLES_NACIONAL','LUCRO_PRESUMIDO','LUCRO_REAL')),
	CONSTRAINT "org_fiscal_environment_check" CHECK ("organization_fiscal_settings"."environment" in ('SIMULATOR','HOMOLOGATION','PRODUCTION')),
	CONSTRAINT "org_fiscal_iss_check" CHECK ("organization_fiscal_settings"."iss_rate_bps" is null or ("organization_fiscal_settings"."iss_rate_bps" >= 0 and "organization_fiscal_settings"."iss_rate_bps" <= 10000))
);
--> statement-breakpoint
ALTER TABLE "work_order_events" DROP CONSTRAINT "work_order_events_type_check";--> statement-breakpoint
ALTER TABLE "quote_items" ALTER COLUMN "work_order_item_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_fk" FOREIGN KEY ("organization_id","invoice_id") REFERENCES "public"."invoices"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_work_order_item_fk" FOREIGN KEY ("organization_id","work_order_item_id") REFERENCES "public"."work_order_items"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_canceled_by_users_id_fk" FOREIGN KEY ("canceled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_work_order_fk" FOREIGN KEY ("organization_id","work_order_id") REFERENCES "public"."work_orders"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "public"."customers"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_vehicle_fk" FOREIGN KEY ("organization_id","vehicle_id") REFERENCES "public"."vehicles"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_fiscal_settings" ADD CONSTRAINT "organization_fiscal_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_items_invoice_idx" ON "invoice_items" USING btree ("organization_id","invoice_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_rps_unique" ON "invoices" USING btree ("organization_id","kind","rps_series","rps_number");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_client_request_unique" ON "invoices" USING btree ("organization_id","client_request_id");--> statement-breakpoint
CREATE INDEX "invoices_org_created_idx" ON "invoices" USING btree ("organization_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "invoices_work_order_idx" ON "invoices" USING btree ("organization_id","work_order_id");--> statement-breakpoint
ALTER TABLE "work_order_events" ADD CONSTRAINT "work_order_events_type_check" CHECK ("work_order_events"."type" in ('CREATED','STATUS_CHANGED','NOTE','ITEMS_CHANGED','CHECK_IN','CHECK_OUT','PHOTO_ADDED','QUOTE_SENT','QUOTE_VIEWED','QUOTE_APPROVED','QUOTE_REJECTED','CUSTOMER_QUESTION','CUSTOMER_NOTIFIED','PAYMENT','DELIVERED','CANCELED','SUPPLIER_QUOTE_SENT','SUPPLIER_QUOTE_ANSWERED','PURCHASE_ORDERED','PURCHASE_RECEIVED','PART_RETURNED','INVOICE_ISSUED','INVOICE_CANCELED'));