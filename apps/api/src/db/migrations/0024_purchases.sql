CREATE TABLE "purchase_order_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"part_id" uuid NOT NULL,
	"work_order_item_id" uuid,
	"supplier_quote_award_id" uuid,
	"description" text NOT NULL,
	"part_code" text,
	"quantity" numeric(12, 3) NOT NULL,
	"unit_cost_cents" bigint NOT NULL,
	"received_quantity" numeric(12, 3) DEFAULT '0' NOT NULL,
	"returned_quantity" numeric(12, 3) DEFAULT '0' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "purchase_order_items_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "purchase_order_items_quantity_check" CHECK ("purchase_order_items"."quantity" > 0),
	CONSTRAINT "purchase_order_items_cost_check" CHECK ("purchase_order_items"."unit_cost_cents" >= 0),
	CONSTRAINT "purchase_order_items_received_check" CHECK ("purchase_order_items"."received_quantity" >= 0 and "purchase_order_items"."received_quantity" <= "purchase_order_items"."quantity"),
	CONSTRAINT "purchase_order_items_returned_check" CHECK ("purchase_order_items"."returned_quantity" >= 0 and "purchase_order_items"."returned_quantity" <= "purchase_order_items"."received_quantity")
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"supplier_id" uuid NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"supplier_quote_request_id" uuid,
	"expected_on" date,
	"shipping_cents" bigint DEFAULT 0 NOT NULL,
	"notes" text,
	"ordered_at" timestamp with time zone,
	"ordered_by" uuid,
	"received_at" timestamp with time zone,
	"closed_short_at" timestamp with time zone,
	"close_reason" text,
	"canceled_at" timestamp with time zone,
	"canceled_by" uuid,
	"cancel_reason" text,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "purchase_orders_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "purchase_orders_org_number_unique" UNIQUE("organization_id","number"),
	CONSTRAINT "purchase_orders_status_check" CHECK ("purchase_orders"."status" in ('DRAFT','ORDERED','PARTIAL','RECEIVED','CANCELED')),
	CONSTRAINT "purchase_orders_shipping_check" CHECK ("purchase_orders"."shipping_cents" >= 0),
	CONSTRAINT "purchase_orders_ordered_check" CHECK ("purchase_orders"."status" in ('DRAFT', 'CANCELED') or "purchase_orders"."ordered_at" is not null),
	CONSTRAINT "purchase_orders_canceled_check" CHECK (("purchase_orders"."status" = 'CANCELED') = ("purchase_orders"."canceled_at" is not null) and ("purchase_orders"."canceled_at" is null or "purchase_orders"."cancel_reason" is not null)),
	CONSTRAINT "purchase_orders_close_reason_check" CHECK ("purchase_orders"."closed_short_at" is null or "purchase_orders"."close_reason" is not null)
);
--> statement-breakpoint
CREATE TABLE "purchase_receipt_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"receipt_id" uuid NOT NULL,
	"purchase_order_item_id" uuid NOT NULL,
	"quantity" numeric(12, 3) NOT NULL,
	"unit_cost_cents" bigint NOT NULL,
	"freight_cents" bigint DEFAULT 0 NOT NULL,
	"landed_unit_cost_cents" bigint NOT NULL,
	"inventory_movement_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_receipt_items_quantity_check" CHECK ("purchase_receipt_items"."quantity" > 0),
	CONSTRAINT "purchase_receipt_items_cost_check" CHECK ("purchase_receipt_items"."unit_cost_cents" >= 0 and "purchase_receipt_items"."freight_cents" >= 0 and "purchase_receipt_items"."landed_unit_cost_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "purchase_receipts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"client_request_id" uuid NOT NULL,
	"invoice_number" text,
	"shipping_cents" bigint DEFAULT 0 NOT NULL,
	"notes" text,
	"received_by" uuid NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_receipts_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "purchase_receipts_client_request_unique" UNIQUE("organization_id","client_request_id"),
	CONSTRAINT "purchase_receipts_shipping_check" CHECK ("purchase_receipts"."shipping_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "purchase_return_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"return_id" uuid NOT NULL,
	"purchase_order_item_id" uuid NOT NULL,
	"quantity" numeric(12, 3) NOT NULL,
	"unit_cost_cents" bigint NOT NULL,
	"inventory_movement_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_return_items_quantity_check" CHECK ("purchase_return_items"."quantity" > 0),
	CONSTRAINT "purchase_return_items_cost_check" CHECK ("purchase_return_items"."unit_cost_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "purchase_returns" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"client_request_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"returned_by" uuid NOT NULL,
	"returned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_returns_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "purchase_returns_client_request_unique" UNIQUE("organization_id","client_request_id"),
	CONSTRAINT "purchase_returns_reason_check" CHECK (length(trim("purchase_returns"."reason")) >= 3)
);
--> statement-breakpoint
ALTER TABLE "work_order_events" DROP CONSTRAINT "work_order_events_type_check";--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_type_check";--> statement-breakpoint
ALTER TABLE "part_price_history" ADD COLUMN "purchase_order_id" uuid;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_order_fk" FOREIGN KEY ("organization_id","purchase_order_id") REFERENCES "public"."purchase_orders"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_part_fk" FOREIGN KEY ("organization_id","part_id") REFERENCES "public"."parts"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_work_order_item_fk" FOREIGN KEY ("organization_id","work_order_item_id") REFERENCES "public"."work_order_items"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_award_fk" FOREIGN KEY ("organization_id","supplier_quote_award_id") REFERENCES "public"."supplier_quote_awards"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_ordered_by_users_id_fk" FOREIGN KEY ("ordered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_canceled_by_users_id_fk" FOREIGN KEY ("canceled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_fk" FOREIGN KEY ("organization_id","supplier_id") REFERENCES "public"."suppliers"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_quote_request_fk" FOREIGN KEY ("organization_id","supplier_quote_request_id") REFERENCES "public"."supplier_quote_requests"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipt_items" ADD CONSTRAINT "purchase_receipt_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipt_items" ADD CONSTRAINT "purchase_receipt_items_receipt_fk" FOREIGN KEY ("organization_id","receipt_id") REFERENCES "public"."purchase_receipts"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipt_items" ADD CONSTRAINT "purchase_receipt_items_order_item_fk" FOREIGN KEY ("organization_id","purchase_order_item_id") REFERENCES "public"."purchase_order_items"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipt_items" ADD CONSTRAINT "purchase_receipt_items_movement_fk" FOREIGN KEY ("inventory_movement_id") REFERENCES "public"."inventory_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_order_fk" FOREIGN KEY ("organization_id","purchase_order_id") REFERENCES "public"."purchase_orders"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_return_items" ADD CONSTRAINT "purchase_return_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_return_items" ADD CONSTRAINT "purchase_return_items_return_fk" FOREIGN KEY ("organization_id","return_id") REFERENCES "public"."purchase_returns"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_return_items" ADD CONSTRAINT "purchase_return_items_order_item_fk" FOREIGN KEY ("organization_id","purchase_order_item_id") REFERENCES "public"."purchase_order_items"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_return_items" ADD CONSTRAINT "purchase_return_items_movement_fk" FOREIGN KEY ("inventory_movement_id") REFERENCES "public"."inventory_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_returned_by_users_id_fk" FOREIGN KEY ("returned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_order_fk" FOREIGN KEY ("organization_id","purchase_order_id") REFERENCES "public"."purchase_orders"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchase_order_items_order_idx" ON "purchase_order_items" USING btree ("organization_id","purchase_order_id","position");--> statement-breakpoint
CREATE INDEX "purchase_order_items_work_order_item_idx" ON "purchase_order_items" USING btree ("organization_id","work_order_item_id");--> statement-breakpoint
CREATE INDEX "purchase_order_items_part_idx" ON "purchase_order_items" USING btree ("organization_id","part_id");--> statement-breakpoint
CREATE INDEX "purchase_orders_status_idx" ON "purchase_orders" USING btree ("organization_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "purchase_orders_supplier_idx" ON "purchase_orders" USING btree ("organization_id","supplier_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "purchase_receipt_items_receipt_idx" ON "purchase_receipt_items" USING btree ("organization_id","receipt_id");--> statement-breakpoint
CREATE INDEX "purchase_receipts_order_idx" ON "purchase_receipts" USING btree ("organization_id","purchase_order_id","received_at");--> statement-breakpoint
CREATE INDEX "purchase_return_items_return_idx" ON "purchase_return_items" USING btree ("organization_id","return_id");--> statement-breakpoint
CREATE INDEX "purchase_returns_order_idx" ON "purchase_returns" USING btree ("organization_id","purchase_order_id","returned_at");--> statement-breakpoint
ALTER TABLE "work_order_events" ADD CONSTRAINT "work_order_events_type_check" CHECK ("work_order_events"."type" in ('CREATED','STATUS_CHANGED','NOTE','ITEMS_CHANGED','CHECK_IN','CHECK_OUT','PHOTO_ADDED','QUOTE_SENT','QUOTE_VIEWED','QUOTE_APPROVED','QUOTE_REJECTED','CUSTOMER_QUESTION','CUSTOMER_NOTIFIED','PAYMENT','DELIVERED','CANCELED','SUPPLIER_QUOTE_SENT','SUPPLIER_QUOTE_ANSWERED','PURCHASE_ORDERED','PURCHASE_RECEIVED'));--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_type_check" CHECK ("notifications"."type" in ('QUOTE_VIEWED','QUOTE_APPROVED','QUOTE_PARTIALLY_APPROVED','QUOTE_REJECTED','QUOTE_QUESTION','SUPPLIER_QUOTE_ANSWERED','PURCHASE_RECEIVED'));