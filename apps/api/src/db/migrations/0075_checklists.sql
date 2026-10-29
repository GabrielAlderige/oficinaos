-- Checklists da oficina (E49): os modelos que o check-in usa, na ordem que a
-- oficina montou. Sem modelo nenhum, o check-in usa o padrão do sistema.

CREATE TABLE "checklist_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"items" jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "checklist_templates_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "checklist_templates_items_check" CHECK (jsonb_typeof("checklist_templates"."items") = 'array' and jsonb_array_length("checklist_templates"."items") between 1 and 40)
);
--> statement-breakpoint
ALTER TABLE "checklist_templates" ADD CONSTRAINT "checklist_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_templates" ADD CONSTRAINT "checklist_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "checklist_templates_org_idx" ON "checklist_templates" USING btree ("organization_id","position");