-- Venda de balcão (E49): a peça vendida sem OS. A venda, os itens, e a
-- ligação da venda com o livro-razão do estoque e com a conta a receber.

CREATE TABLE "counter_sale_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"part_id" uuid,
	"description" text NOT NULL,
	"quantity" numeric(12, 3) NOT NULL,
	"unit_price_cents" bigint NOT NULL,
	"unit_cost_cents" bigint,
	"total_cents" bigint NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "counter_sale_items_quantity_check" CHECK ("counter_sale_items"."quantity" > 0),
	CONSTRAINT "counter_sale_items_amounts_check" CHECK ("counter_sale_items"."unit_price_cents" >= 0 and "counter_sale_items"."total_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "counter_sales" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"status" text DEFAULT 'COMPLETED' NOT NULL,
	"customer_id" uuid,
	"subtotal_cents" bigint NOT NULL,
	"discount_cents" bigint DEFAULT 0 NOT NULL,
	"total_cents" bigint NOT NULL,
	"notes" text,
	"client_request_id" uuid NOT NULL,
	"sold_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sold_by" uuid,
	"canceled_at" timestamp with time zone,
	"canceled_by" uuid,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "counter_sales_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "counter_sales_org_number_unique" UNIQUE("organization_id","number"),
	CONSTRAINT "counter_sales_client_request_unique" UNIQUE("organization_id","client_request_id"),
	CONSTRAINT "counter_sales_status_check" CHECK ("counter_sales"."status" in ('COMPLETED','CANCELED')),
	CONSTRAINT "counter_sales_number_check" CHECK ("counter_sales"."number" > 0),
	CONSTRAINT "counter_sales_amounts_check" CHECK ("counter_sales"."subtotal_cents" >= 0 and "counter_sales"."discount_cents" >= 0 and "counter_sales"."discount_cents" <= "counter_sales"."subtotal_cents" and "counter_sales"."total_cents" = "counter_sales"."subtotal_cents" - "counter_sales"."discount_cents"),
	CONSTRAINT "counter_sales_canceled_check" CHECK (("counter_sales"."status" = 'CANCELED') = ("counter_sales"."canceled_at" is not null) and ("counter_sales"."canceled_at" is null or "counter_sales"."cancel_reason" is not null))
);
--> statement-breakpoint
ALTER TABLE "inventory_movements" DROP CONSTRAINT "inventory_movements_type_check";--> statement-breakpoint
ALTER TABLE "financial_entries" DROP CONSTRAINT "financial_entries_origin_check";--> statement-breakpoint
ALTER TABLE "financial_entries" DROP CONSTRAINT "financial_entries_origin_document_check";--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD COLUMN "counter_sale_id" uuid;--> statement-breakpoint
ALTER TABLE "financial_entries" ADD COLUMN "counter_sale_id" uuid;--> statement-breakpoint
ALTER TABLE "counter_sale_items" ADD CONSTRAINT "counter_sale_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "counter_sale_items" ADD CONSTRAINT "counter_sale_items_sale_fk" FOREIGN KEY ("organization_id","sale_id") REFERENCES "public"."counter_sales"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "counter_sale_items" ADD CONSTRAINT "counter_sale_items_part_fk" FOREIGN KEY ("organization_id","part_id") REFERENCES "public"."parts"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "counter_sales" ADD CONSTRAINT "counter_sales_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "counter_sales" ADD CONSTRAINT "counter_sales_sold_by_users_id_fk" FOREIGN KEY ("sold_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "counter_sales" ADD CONSTRAINT "counter_sales_canceled_by_users_id_fk" FOREIGN KEY ("canceled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "counter_sales" ADD CONSTRAINT "counter_sales_customer_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "public"."customers"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "counter_sale_items_sale_idx" ON "counter_sale_items" USING btree ("organization_id","sale_id","position");--> statement-breakpoint
CREATE INDEX "counter_sales_sold_idx" ON "counter_sales" USING btree ("organization_id","sold_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "counter_sales_customer_idx" ON "counter_sales" USING btree ("organization_id","customer_id");--> statement-breakpoint
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_counter_sale_fk" FOREIGN KEY ("organization_id","counter_sale_id") REFERENCES "public"."counter_sales"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "financial_entries_counter_sale_idx" ON "financial_entries" USING btree ("organization_id","counter_sale_id");--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_type_check" CHECK ("inventory_movements"."type" in ('INITIAL','MANUAL_IN','ADJUSTMENT','WORK_ORDER_OUT','CUSTOMER_RETURN','PURCHASE_IN','SUPPLIER_RETURN','COUNTER_SALE_OUT','COUNTER_SALE_RETURN'));--> statement-breakpoint
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_origin_check" CHECK ("financial_entries"."origin" in ('MANUAL','WORK_ORDER','PURCHASE','COUNTER_SALE'));--> statement-breakpoint
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_origin_document_check" CHECK (("financial_entries"."origin" <> 'WORK_ORDER' or "financial_entries"."work_order_id" is not null) and ("financial_entries"."origin" <> 'PURCHASE' or "financial_entries"."purchase_order_id" is not null) and ("financial_entries"."origin" <> 'COUNTER_SALE' or "financial_entries"."counter_sale_id" is not null));