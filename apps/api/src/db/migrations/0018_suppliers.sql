CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"legal_name" text,
	"document" text,
	"contact_name" text,
	"phone" text,
	"whatsapp" text,
	"email" "citext",
	"address" jsonb,
	"categories" text[] DEFAULT '{}'::text[] NOT NULL,
	"lead_time_days" smallint,
	"rating" smallint,
	"notes" text,
	"created_by" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "suppliers_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "suppliers_rating_check" CHECK ("suppliers"."rating" is null or "suppliers"."rating" between 1 and 5),
	CONSTRAINT "suppliers_lead_time_check" CHECK ("suppliers"."lead_time_days" is null or "suppliers"."lead_time_days" between 0 and 365)
);
--> statement-breakpoint
ALTER TABLE "parts" ADD COLUMN "preferred_supplier_id" uuid;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_org_document_unique" ON "suppliers" USING btree ("organization_id","document") WHERE document is not null and deleted_at is null;--> statement-breakpoint
CREATE INDEX "suppliers_org_name_idx" ON "suppliers" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "suppliers_name_search_idx" ON "suppliers" USING gin (immutable_unaccent(name) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "suppliers_categories_idx" ON "suppliers" USING gin ("categories");--> statement-breakpoint
ALTER TABLE "parts" ADD CONSTRAINT "parts_preferred_supplier_fk" FOREIGN KEY ("organization_id","preferred_supplier_id") REFERENCES "public"."suppliers"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "parts_org_preferred_supplier_idx" ON "parts" USING btree ("organization_id","preferred_supplier_id");