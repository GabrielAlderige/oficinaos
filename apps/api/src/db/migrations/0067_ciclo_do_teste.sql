-- E-mails do ciclo do teste grátis: boas-vindas, metade do teste, faltam 3
-- dias, último dia e teste acabou. Uma linha por oficina e tipo garante que
-- cada um sai UMA vez, mesmo com o trabalhador acordando de hora em hora.
--
-- (O snapshot do drizzle desta migration também passa a conhecer
-- tutorial_lessons, tutorial_views e prospects, criadas antes à mão: só o
-- snapshot, nenhuma tabela é recriada aqui.)

CREATE TABLE "lifecycle_emails" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"sent_to" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lifecycle_emails" ADD CONSTRAINT "lifecycle_emails_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "lifecycle_emails_org_kind_unique" ON "lifecycle_emails" USING btree ("organization_id","kind");
--> statement-breakpoint
ALTER TABLE "lifecycle_emails" ADD CONSTRAINT "lifecycle_emails_kind_check"
	CHECK (kind IN ('BOAS_VINDAS', 'METADE_DO_TESTE', 'FALTAM_3_DIAS', 'ULTIMO_DIA', 'TESTE_ACABOU'));
--> statement-breakpoint

-- cada oficina enxerga só os próprios registros (a volta do trabalhador entra com o contexto da oficina)
SELECT app_enable_tenant_rls('lifecycle_emails');
