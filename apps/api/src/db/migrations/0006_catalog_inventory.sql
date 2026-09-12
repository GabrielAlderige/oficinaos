CREATE TABLE "inventory_movements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"part_id" uuid NOT NULL,
	"type" text NOT NULL,
	"quantity" numeric(12, 3) NOT NULL,
	"unit_cost_cents" bigint,
	"balance_after" numeric(12, 3) NOT NULL,
	"average_cost_after_cents" bigint,
	"work_order_id" uuid,
	"work_order_item_id" uuid,
	"purchase_order_id" uuid,
	"reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_movements_type_check" CHECK ("inventory_movements"."type" in ('INITIAL','MANUAL_IN','ADJUSTMENT','WORK_ORDER_OUT','CUSTOMER_RETURN','PURCHASE_IN','SUPPLIER_RETURN')),
	CONSTRAINT "inventory_movements_quantity_check" CHECK ("inventory_movements"."quantity" <> 0)
);
--> statement-breakpoint
CREATE TABLE "part_applications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"part_id" uuid NOT NULL,
	"make" text NOT NULL,
	"model" text,
	"engine" text,
	"year_from" smallint,
	"year_to" smallint,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "part_categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "part_categories_org_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "parts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sku" text,
	"manufacturer_code" text,
	"manufacturer" text,
	"category_id" uuid,
	"description" text,
	"unit" text DEFAULT 'UN' NOT NULL,
	"ean" text,
	"ncm" text,
	"last_cost_cents" bigint,
	"average_cost_cents" bigint,
	"sale_price_cents" bigint,
	"markup_bps" integer,
	"track_stock" boolean DEFAULT true NOT NULL,
	"quantity_on_hand" numeric(12, 3) DEFAULT '0' NOT NULL,
	"quantity_reserved" numeric(12, 3) DEFAULT '0' NOT NULL,
	"min_quantity" numeric(12, 3) DEFAULT '0' NOT NULL,
	"location" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "parts_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "parts_unit_check" CHECK ("parts"."unit" in ('UN','PAR','JG','KIT','L','ML','KG','M')),
	CONSTRAINT "parts_quantities_check" CHECK ("parts"."quantity_reserved" >= 0 and "parts"."min_quantity" >= 0),
	CONSTRAINT "parts_prices_check" CHECK (coalesce("parts"."sale_price_cents", 0) >= 0 and coalesce("parts"."last_cost_cents", 0) >= 0)
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"description" text,
	"pricing_mode" text DEFAULT 'FIXED' NOT NULL,
	"price_cents" bigint,
	"estimated_minutes" integer,
	"interval_km" integer,
	"interval_months" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "services_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "services_pricing_mode_check" CHECK ("services"."pricing_mode" in ('FIXED','HOURLY')),
	CONSTRAINT "services_price_check" CHECK ("services"."price_cents" is null or "services"."price_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_part_fk" FOREIGN KEY ("organization_id","part_id") REFERENCES "public"."parts"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_applications" ADD CONSTRAINT "part_applications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_applications" ADD CONSTRAINT "part_applications_part_fk" FOREIGN KEY ("organization_id","part_id") REFERENCES "public"."parts"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_categories" ADD CONSTRAINT "part_categories_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parts" ADD CONSTRAINT "parts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parts" ADD CONSTRAINT "parts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parts" ADD CONSTRAINT "parts_category_fk" FOREIGN KEY ("organization_id","category_id") REFERENCES "public"."part_categories"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_movements_part_idx" ON "inventory_movements" USING btree ("organization_id","part_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "part_applications_part_idx" ON "part_applications" USING btree ("organization_id","part_id");--> statement-breakpoint
CREATE INDEX "part_applications_search_idx" ON "part_applications" USING gin (immutable_unaccent(make || ' ' || coalesce(model, '') || ' ' || coalesce(engine, '')) gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "part_categories_org_name_unique" ON "part_categories" USING btree ("organization_id",lower(name));--> statement-breakpoint
CREATE UNIQUE INDEX "parts_org_sku_unique" ON "parts" USING btree ("organization_id",lower(sku)) WHERE sku is not null and deleted_at is null;--> statement-breakpoint
CREATE INDEX "parts_name_search_idx" ON "parts" USING gin (immutable_unaccent(name) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "parts_org_manufacturer_code_idx" ON "parts" USING btree ("organization_id","manufacturer_code" text_pattern_ops);--> statement-breakpoint
CREATE INDEX "parts_org_category_idx" ON "parts" USING btree ("organization_id","category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "services_org_name_unique" ON "services" USING btree ("organization_id",lower(name)) WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "services_name_search_idx" ON "services" USING gin (immutable_unaccent(name) gin_trgm_ops);