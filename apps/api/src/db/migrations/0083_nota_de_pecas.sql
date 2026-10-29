-- Nota fiscal de peças (E50): NFC-e e NF-e, da venda de balcão ou das peças da
-- OS, com os itens congelados; e o CFOP e a situação do ICMS padrão da oficina.

CREATE TABLE "product_invoice_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"part_id" uuid,
	"description" text NOT NULL,
	"ncm" text NOT NULL,
	"cfop" text NOT NULL,
	"unit" text NOT NULL,
	"quantity" numeric(12, 3) NOT NULL,
	"unit_price_cents" bigint NOT NULL,
	"discount_cents" bigint DEFAULT 0 NOT NULL,
	"total_cents" bigint NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_invoice_items_quantity_check" CHECK ("product_invoice_items"."quantity" > 0),
	CONSTRAINT "product_invoice_items_money_check" CHECK ("product_invoice_items"."unit_price_cents" >= 0 and "product_invoice_items"."total_cents" >= 0 and "product_invoice_items"."discount_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "product_invoices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"model" text NOT NULL,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"environment" text NOT NULL,
	"provider" text,
	"counter_sale_id" uuid,
	"work_order_id" uuid,
	"customer_id" uuid,
	"client_request_id" uuid NOT NULL,
	"number" text,
	"series" text,
	"access_key" text,
	"provider_ref" text,
	"danfe_url" text,
	"xml_url" text,
	"qrcode_url" text,
	"total_cents" bigint NOT NULL,
	"provider_response" jsonb,
	"rejection_reason" text,
	"issued_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"cancel_reason" text,
	"canceled_by" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "product_invoices_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "product_invoices_model_check" CHECK ("product_invoices"."model" in ('NFCE','NFE')),
	CONSTRAINT "product_invoices_status_check" CHECK ("product_invoices"."status" in ('DRAFT','QUEUED','AUTHORIZED','REJECTED','CANCELED')),
	CONSTRAINT "product_invoices_environment_check" CHECK ("product_invoices"."environment" in ('SIMULATOR','HOMOLOGATION','PRODUCTION')),
	CONSTRAINT "product_invoices_origin_check" CHECK (("product_invoices"."counter_sale_id" is null) <> ("product_invoices"."work_order_id" is null)),
	CONSTRAINT "product_invoices_money_check" CHECK ("product_invoices"."total_cents" >= 0),
	CONSTRAINT "product_invoices_authorized_check" CHECK ("product_invoices"."status" <> 'AUTHORIZED' or "product_invoices"."issued_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "organization_fiscal_settings" ADD COLUMN "product_cfop" text;--> statement-breakpoint
ALTER TABLE "organization_fiscal_settings" ADD COLUMN "product_icms_situation" text;--> statement-breakpoint
ALTER TABLE "product_invoice_items" ADD CONSTRAINT "product_invoice_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_invoice_items" ADD CONSTRAINT "product_invoice_items_invoice_fk" FOREIGN KEY ("organization_id","invoice_id") REFERENCES "public"."product_invoices"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_invoice_items" ADD CONSTRAINT "product_invoice_items_part_fk" FOREIGN KEY ("organization_id","part_id") REFERENCES "public"."parts"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_invoices" ADD CONSTRAINT "product_invoices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_invoices" ADD CONSTRAINT "product_invoices_canceled_by_users_id_fk" FOREIGN KEY ("canceled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_invoices" ADD CONSTRAINT "product_invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_invoices" ADD CONSTRAINT "product_invoices_counter_sale_fk" FOREIGN KEY ("organization_id","counter_sale_id") REFERENCES "public"."counter_sales"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_invoices" ADD CONSTRAINT "product_invoices_work_order_fk" FOREIGN KEY ("organization_id","work_order_id") REFERENCES "public"."work_orders"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_invoices" ADD CONSTRAINT "product_invoices_customer_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "public"."customers"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_invoice_items_invoice_idx" ON "product_invoice_items" USING btree ("organization_id","invoice_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "product_invoices_client_request_unique" ON "product_invoices" USING btree ("organization_id","client_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_invoices_sale_alive_unique" ON "product_invoices" USING btree ("organization_id","counter_sale_id") WHERE counter_sale_id is not null and status in ('QUEUED', 'AUTHORIZED');--> statement-breakpoint
CREATE UNIQUE INDEX "product_invoices_work_order_alive_unique" ON "product_invoices" USING btree ("organization_id","work_order_id") WHERE work_order_id is not null and status in ('QUEUED', 'AUTHORIZED');--> statement-breakpoint
CREATE INDEX "product_invoices_created_idx" ON "product_invoices" USING btree ("organization_id","created_at" DESC NULLS LAST);