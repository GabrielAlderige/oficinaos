CREATE TABLE "part_offers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"query_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"is_mock" boolean DEFAULT false NOT NULL,
	"supplier_id" uuid,
	"part_id" uuid,
	"title" text NOT NULL,
	"brand" text,
	"code" text,
	"price_cents" bigint NOT NULL,
	"shipping_cents" bigint DEFAULT 0 NOT NULL,
	"availability" text NOT NULL,
	"lead_time_days" smallint,
	"available_quantity" numeric(12, 3),
	"offer_url" text,
	"raw" jsonb,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "part_offers_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "part_offers_provider_check" CHECK ("part_offers"."provider" in ('internal','price_list','rfq','mock')),
	CONSTRAINT "part_offers_availability_check" CHECK ("part_offers"."availability" in ('IN_STOCK','TO_ORDER','UNAVAILABLE')),
	CONSTRAINT "part_offers_price_check" CHECK ("part_offers"."price_cents" >= 0 and "part_offers"."shipping_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "part_search_queries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"query" text NOT NULL,
	"vehicle_id" uuid,
	"providers" text[] DEFAULT '{}'::text[] NOT NULL,
	"requested_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "part_search_queries_org_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "supplier_price_list_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"brand" text,
	"price_cents" bigint NOT NULL,
	"unit" text,
	"import_batch" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "supplier_price_list_items_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "supplier_price_list_items_price_check" CHECK ("supplier_price_list_items"."price_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "part_offers" ADD CONSTRAINT "part_offers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_offers" ADD CONSTRAINT "part_offers_query_fk" FOREIGN KEY ("organization_id","query_id") REFERENCES "public"."part_search_queries"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_offers" ADD CONSTRAINT "part_offers_supplier_fk" FOREIGN KEY ("organization_id","supplier_id") REFERENCES "public"."suppliers"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_offers" ADD CONSTRAINT "part_offers_part_fk" FOREIGN KEY ("organization_id","part_id") REFERENCES "public"."parts"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_search_queries" ADD CONSTRAINT "part_search_queries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_search_queries" ADD CONSTRAINT "part_search_queries_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_search_queries" ADD CONSTRAINT "part_search_queries_vehicle_fk" FOREIGN KEY ("organization_id","vehicle_id") REFERENCES "public"."vehicles"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_price_list_items" ADD CONSTRAINT "supplier_price_list_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_price_list_items" ADD CONSTRAINT "supplier_price_list_items_supplier_fk" FOREIGN KEY ("organization_id","supplier_id") REFERENCES "public"."suppliers"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "part_offers_query_idx" ON "part_offers" USING btree ("organization_id","query_id","position");--> statement-breakpoint
CREATE INDEX "part_search_queries_org_idx" ON "part_search_queries" USING btree ("organization_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_price_list_items_code_unique" ON "supplier_price_list_items" USING btree ("organization_id","supplier_id",lower(code)) WHERE code is not null;--> statement-breakpoint
CREATE INDEX "supplier_price_list_items_supplier_idx" ON "supplier_price_list_items" USING btree ("organization_id","supplier_id","name");--> statement-breakpoint
CREATE INDEX "supplier_price_list_items_name_idx" ON "supplier_price_list_items" USING gin (immutable_unaccent(name) gin_trgm_ops);