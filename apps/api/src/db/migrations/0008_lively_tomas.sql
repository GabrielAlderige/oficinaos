CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"work_order_id" uuid,
	"work_order_item_id" uuid,
	"inspection_id" uuid,
	"vehicle_id" uuid,
	"kind" text DEFAULT 'PHOTO' NOT NULL,
	"storage_key" text NOT NULL,
	"file_name" text,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"width" integer,
	"height" integer,
	"caption" text,
	"visible_to_customer" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'PENDING_UPLOAD' NOT NULL,
	"uploaded_by" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "attachments_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "attachments_kind_check" CHECK ("attachments"."kind" in ('PHOTO','VIDEO','DOCUMENT')),
	CONSTRAINT "attachments_status_check" CHECK ("attachments"."status" in ('PENDING_UPLOAD','READY')),
	CONSTRAINT "attachments_size_check" CHECK ("attachments"."size_bytes" > 0),
	CONSTRAINT "attachments_parent_check" CHECK ("attachments"."work_order_id" is not null or "attachments"."inspection_id" is not null or "attachments"."vehicle_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "vehicle_inspections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"type" text NOT NULL,
	"odometer_km" integer,
	"fuel_level" smallint,
	"checklist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"damages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"accessories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"customer_acknowledged_at" timestamp with time zone,
	"signature_attachment_id" uuid,
	"performed_by" uuid,
	"performed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_inspections_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "vehicle_inspections_type_check" CHECK ("vehicle_inspections"."type" in ('CHECK_IN','CHECK_OUT')),
	CONSTRAINT "vehicle_inspections_fuel_check" CHECK ("vehicle_inspections"."fuel_level" is null or "vehicle_inspections"."fuel_level" between 0 and 8),
	CONSTRAINT "vehicle_inspections_odometer_check" CHECK ("vehicle_inspections"."odometer_km" is null or "vehicle_inspections"."odometer_km" >= 0)
);
--> statement-breakpoint
CREATE TABLE "work_order_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"type" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor_type" text DEFAULT 'USER' NOT NULL,
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_order_events_type_check" CHECK ("work_order_events"."type" in ('CREATED','STATUS_CHANGED','NOTE','ITEMS_CHANGED','CHECK_IN','CHECK_OUT','PHOTO_ADDED','QUOTE_SENT','QUOTE_VIEWED','QUOTE_APPROVED','QUOTE_REJECTED','CUSTOMER_QUESTION','PAYMENT','DELIVERED','CANCELED')),
	CONSTRAINT "work_order_events_actor_check" CHECK ("work_order_events"."actor_type" in ('USER','CUSTOMER','SYSTEM'))
);
--> statement-breakpoint
CREATE TABLE "work_order_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"type" text NOT NULL,
	"service_id" uuid,
	"part_id" uuid,
	"description" text NOT NULL,
	"part_code" text,
	"brand" text,
	"quantity" numeric(12, 3) DEFAULT '1' NOT NULL,
	"unit_price_cents" bigint NOT NULL,
	"unit_cost_cents" bigint,
	"discount_cents" bigint DEFAULT 0 NOT NULL,
	"total_cents" bigint DEFAULT 0 NOT NULL,
	"is_optional" boolean DEFAULT false NOT NULL,
	"approval_status" text DEFAULT 'DRAFT' NOT NULL,
	"sourcing" text DEFAULT 'STOCK' NOT NULL,
	"stock_status" text DEFAULT 'NONE' NOT NULL,
	"reserved_quantity" numeric(12, 3) DEFAULT '0' NOT NULL,
	"mechanic_user_id" uuid,
	"estimated_minutes" integer,
	"actual_minutes" integer,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "work_order_items_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "work_order_items_type_check" CHECK ("work_order_items"."type" in ('SERVICE','PART')),
	CONSTRAINT "work_order_items_approval_check" CHECK ("work_order_items"."approval_status" in ('DRAFT','PENDING','APPROVED','REJECTED')),
	CONSTRAINT "work_order_items_sourcing_check" CHECK ("work_order_items"."sourcing" in ('STOCK','TO_ORDER','CUSTOMER_PROVIDED')),
	CONSTRAINT "work_order_items_stock_status_check" CHECK ("work_order_items"."stock_status" in ('NONE','RESERVED','PARTIAL','CONSUMED','RELEASED')),
	CONSTRAINT "work_order_items_quantity_check" CHECK ("work_order_items"."quantity" > 0 and "work_order_items"."reserved_quantity" >= 0),
	CONSTRAINT "work_order_items_money_check" CHECK ("work_order_items"."unit_price_cents" >= 0 and "work_order_items"."discount_cents" >= 0 and "work_order_items"."total_cents" >= 0),
	CONSTRAINT "work_order_items_service_has_no_part_check" CHECK (("work_order_items"."type" = 'SERVICE' and "work_order_items"."part_id" is null) or ("work_order_items"."type" = 'PART' and "work_order_items"."service_id" is null))
);
--> statement-breakpoint
CREATE TABLE "work_orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"customer_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"appointment_id" uuid,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"payment_status" text DEFAULT 'UNPAID' NOT NULL,
	"odometer_km" integer,
	"complaint" text,
	"diagnosis" text,
	"customer_notes" text,
	"internal_notes" text,
	"advisor_user_id" uuid,
	"mechanic_user_id" uuid,
	"parts_subtotal_cents" bigint DEFAULT 0 NOT NULL,
	"services_subtotal_cents" bigint DEFAULT 0 NOT NULL,
	"discount_mode" text,
	"discount_value" bigint DEFAULT 0 NOT NULL,
	"discount_cents" bigint DEFAULT 0 NOT NULL,
	"surcharge_cents" bigint DEFAULT 0 NOT NULL,
	"total_cents" bigint DEFAULT 0 NOT NULL,
	"approved_total_cents" bigint DEFAULT 0 NOT NULL,
	"paid_cents" bigint DEFAULT 0 NOT NULL,
	"promised_at" timestamp with time zone,
	"warranty_days" integer,
	"warranty_km" integer,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"cancel_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "work_orders_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "work_orders_org_number_unique" UNIQUE("organization_id","number"),
	CONSTRAINT "work_orders_status_check" CHECK ("work_orders"."status" in ('OPEN','DIAGNOSING','AWAITING_QUOTE','AWAITING_APPROVAL','APPROVED','IN_PROGRESS','WAITING_PARTS','COMPLETED','DELIVERED','CANCELED')),
	CONSTRAINT "work_orders_payment_status_check" CHECK ("work_orders"."payment_status" in ('UNPAID','PARTIAL','PAID')),
	CONSTRAINT "work_orders_discount_mode_check" CHECK ("work_orders"."discount_mode" is null or "work_orders"."discount_mode" in ('AMOUNT','PERCENT')),
	CONSTRAINT "work_orders_number_check" CHECK ("work_orders"."number" > 0),
	CONSTRAINT "work_orders_odometer_check" CHECK ("work_orders"."odometer_km" is null or "work_orders"."odometer_km" >= 0),
	CONSTRAINT "work_orders_money_check" CHECK ("work_orders"."discount_value" >= 0 and "work_orders"."discount_cents" >= 0 and "work_orders"."surcharge_cents" >= 0 and "work_orders"."total_cents" >= 0 and "work_orders"."paid_cents" >= 0),
	CONSTRAINT "work_orders_cancel_reason_check" CHECK ("work_orders"."canceled_at" is null or "work_orders"."cancel_reason" is not null)
);
--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_work_order_fk" FOREIGN KEY ("organization_id","work_order_id") REFERENCES "public"."work_orders"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_work_order_item_fk" FOREIGN KEY ("organization_id","work_order_item_id") REFERENCES "public"."work_order_items"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_inspection_fk" FOREIGN KEY ("organization_id","inspection_id") REFERENCES "public"."vehicle_inspections"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_vehicle_fk" FOREIGN KEY ("organization_id","vehicle_id") REFERENCES "public"."vehicles"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_inspections" ADD CONSTRAINT "vehicle_inspections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_inspections" ADD CONSTRAINT "vehicle_inspections_performed_by_users_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_inspections" ADD CONSTRAINT "vehicle_inspections_work_order_fk" FOREIGN KEY ("organization_id","work_order_id") REFERENCES "public"."work_orders"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_inspections" ADD CONSTRAINT "vehicle_inspections_vehicle_fk" FOREIGN KEY ("organization_id","vehicle_id") REFERENCES "public"."vehicles"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_events" ADD CONSTRAINT "work_order_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_events" ADD CONSTRAINT "work_order_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_events" ADD CONSTRAINT "work_order_events_work_order_fk" FOREIGN KEY ("organization_id","work_order_id") REFERENCES "public"."work_orders"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_items" ADD CONSTRAINT "work_order_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_items" ADD CONSTRAINT "work_order_items_mechanic_user_id_users_id_fk" FOREIGN KEY ("mechanic_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_items" ADD CONSTRAINT "work_order_items_work_order_fk" FOREIGN KEY ("organization_id","work_order_id") REFERENCES "public"."work_orders"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_items" ADD CONSTRAINT "work_order_items_service_fk" FOREIGN KEY ("organization_id","service_id") REFERENCES "public"."services"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_items" ADD CONSTRAINT "work_order_items_part_fk" FOREIGN KEY ("organization_id","part_id") REFERENCES "public"."parts"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_advisor_user_id_users_id_fk" FOREIGN KEY ("advisor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_mechanic_user_id_users_id_fk" FOREIGN KEY ("mechanic_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_customer_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "public"."customers"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_vehicle_fk" FOREIGN KEY ("organization_id","vehicle_id") REFERENCES "public"."vehicles"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachments_org_work_order_idx" ON "attachments" USING btree ("organization_id","work_order_id");--> statement-breakpoint
CREATE INDEX "vehicle_inspections_order_idx" ON "vehicle_inspections" USING btree ("organization_id","work_order_id","performed_at");--> statement-breakpoint
CREATE INDEX "work_order_events_order_idx" ON "work_order_events" USING btree ("organization_id","work_order_id","created_at");--> statement-breakpoint
CREATE INDEX "work_order_items_order_idx" ON "work_order_items" USING btree ("organization_id","work_order_id","position");--> statement-breakpoint
CREATE INDEX "work_orders_org_status_idx" ON "work_orders" USING btree ("organization_id","status","opened_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "work_orders_org_vehicle_idx" ON "work_orders" USING btree ("organization_id","vehicle_id","opened_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "work_orders_org_customer_idx" ON "work_orders" USING btree ("organization_id","customer_id","opened_at" DESC NULLS LAST);