-- unaccent() não é IMMUTABLE (depende do dicionário), então não pode entrar em índice.
-- O wrapper fixa o dicionário e é o que os índices de busca sem acento usam.
CREATE OR REPLACE FUNCTION immutable_unaccent(text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
  SELECT public.unaccent('public.unaccent'::regdictionary, $1)
$$;
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"type" text DEFAULT 'PF' NOT NULL,
	"name" text NOT NULL,
	"document" text,
	"phone" text,
	"whatsapp" text,
	"email" "citext",
	"address" jsonb,
	"notes" text,
	"source" text,
	"marketing_opt_in" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "customers_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "customers_type_check" CHECK ("customers"."type" in ('PF','PJ')),
	CONSTRAINT "customers_source_check" CHECK ("customers"."source" is null or "customers"."source" in ('INDICACAO','GOOGLE','REDES_SOCIAIS','PASSANTE','FROTA','OUTRO'))
);
--> statement-breakpoint
CREATE TABLE "odometer_readings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"km" integer NOT NULL,
	"source" text NOT NULL,
	"work_order_id" uuid,
	"recorded_by" uuid,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "odometer_readings_km_check" CHECK ("odometer_readings"."km" >= 0),
	CONSTRAINT "odometer_readings_source_check" CHECK ("odometer_readings"."source" in ('MANUAL','CHECK_IN','WORK_ORDER'))
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"plate" text,
	"plate_canonical" text,
	"make" text NOT NULL,
	"model" text NOT NULL,
	"version" text,
	"engine" text,
	"color" text,
	"year_manufacture" smallint,
	"year_model" smallint,
	"fuel" text,
	"transmission" text,
	"vin" text,
	"odometer_km" integer,
	"odometer_updated_at" timestamp with time zone,
	"notes" text,
	"created_by" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "vehicles_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "vehicles_fuel_check" CHECK ("vehicles"."fuel" is null or "vehicles"."fuel" in ('FLEX','GASOLINA','ETANOL','DIESEL','GNV','HIBRIDO','ELETRICO')),
	CONSTRAINT "vehicles_transmission_check" CHECK ("vehicles"."transmission" is null or "vehicles"."transmission" in ('MANUAL','AUTOMATICO','AUTOMATIZADO','CVT')),
	CONSTRAINT "vehicles_years_check" CHECK ("vehicles"."year_manufacture" is null or "vehicles"."year_manufacture" between 1950 and 2100),
	CONSTRAINT "vehicles_odometer_check" CHECK ("vehicles"."odometer_km" is null or "vehicles"."odometer_km" >= 0)
);
--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "odometer_readings" ADD CONSTRAINT "odometer_readings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "odometer_readings" ADD CONSTRAINT "odometer_readings_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "odometer_readings" ADD CONSTRAINT "odometer_readings_vehicle_fk" FOREIGN KEY ("organization_id","vehicle_id") REFERENCES "public"."vehicles"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_customer_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "public"."customers"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customers_org_document_unique" ON "customers" USING btree ("organization_id","document") WHERE document is not null and deleted_at is null;--> statement-breakpoint
CREATE INDEX "customers_org_name_idx" ON "customers" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "customers_name_search_idx" ON "customers" USING gin (immutable_unaccent(name) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "odometer_readings_vehicle_idx" ON "odometer_readings" USING btree ("organization_id","vehicle_id","recorded_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "vehicles_org_plate_unique" ON "vehicles" USING btree ("organization_id","plate_canonical") WHERE plate_canonical is not null and deleted_at is null;--> statement-breakpoint
CREATE INDEX "vehicles_org_plate_prefix_idx" ON "vehicles" USING btree ("organization_id","plate_canonical" text_pattern_ops);--> statement-breakpoint
CREATE INDEX "vehicles_org_customer_idx" ON "vehicles" USING btree ("organization_id","customer_id");--> statement-breakpoint
CREATE INDEX "vehicles_model_search_idx" ON "vehicles" USING gin (immutable_unaccent(make || ' ' || model) gin_trgm_ops);