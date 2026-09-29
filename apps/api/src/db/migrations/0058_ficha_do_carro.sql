CREATE TABLE "catalog_vehicle_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"make" text NOT NULL,
	"model" text NOT NULL,
	"year" smallint,
	"note" text,
	"requested_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_vehicle_requests_once" UNIQUE("organization_id","make","model","year")
);
--> statement-breakpoint
CREATE TABLE "catalog_vehicle_specs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"key" text,
	"custom_label" text,
	"group" text NOT NULL,
	"value" text NOT NULL,
	"note" text,
	"position" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_vehicle_specs_group_check" CHECK ("catalog_vehicle_specs"."group" in ('MOTOR', 'FILTROS', 'FREIOS', 'SUSPENSAO', 'ELETRICA', 'FLUIDOS', 'PNEUS')),
	CONSTRAINT "catalog_vehicle_specs_label_check" CHECK (("catalog_vehicle_specs"."key" is not null and "catalog_vehicle_specs"."key" <> '') or ("catalog_vehicle_specs"."custom_label" is not null and "catalog_vehicle_specs"."custom_label" <> ''))
);
--> statement-breakpoint
CREATE TABLE "catalog_vehicles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"make" text NOT NULL,
	"model" text NOT NULL,
	"version" text,
	"year_from" smallint,
	"year_to" smallint,
	"notes" text,
	"published_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "catalog_vehicles_identity_unique" UNIQUE("make","model","version","year_from","year_to"),
	CONSTRAINT "catalog_vehicles_years_check" CHECK ("catalog_vehicles"."year_from" is null or "catalog_vehicles"."year_to" is null or "catalog_vehicles"."year_from" <= "catalog_vehicles"."year_to")
);
--> statement-breakpoint
ALTER TABLE "catalog_vehicle_requests" ADD CONSTRAINT "catalog_vehicle_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_vehicle_requests" ADD CONSTRAINT "catalog_vehicle_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_vehicle_specs" ADD CONSTRAINT "catalog_vehicle_specs_vehicle_id_catalog_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."catalog_vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_vehicles" ADD CONSTRAINT "catalog_vehicles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalog_vehicle_requests_recent_idx" ON "catalog_vehicle_requests" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "catalog_vehicle_specs_vehicle_idx" ON "catalog_vehicle_specs" USING btree ("vehicle_id","position");--> statement-breakpoint
CREATE INDEX "catalog_vehicles_search_idx" ON "catalog_vehicles" USING gin (immutable_unaccent("make" || ' ' || "model" || ' ' || coalesce("version", '')) gin_trgm_ops);