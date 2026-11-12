ALTER TABLE "financial_entries" ADD COLUMN "competence_date" date;--> statement-breakpoint
ALTER TABLE "organization_fiscal_settings" ADD COLUMN "tax_regime_source" text;--> statement-breakpoint
ALTER TABLE "organization_fiscal_settings" ADD COLUMN "tax_regime_detail" text;--> statement-breakpoint
ALTER TABLE "organization_fiscal_settings" ADD COLUMN "tax_regime_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organization_fiscal_settings" ADD COLUMN "parts_icms_st" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_fiscal_settings" ADD COLUMN "icms_rate_bps" integer;--> statement-breakpoint
ALTER TABLE "organization_fiscal_settings" ADD COLUMN "mei_das_cents" bigint;--> statement-breakpoint
ALTER TABLE "organization_fiscal_settings" ADD CONSTRAINT "org_fiscal_icms_check" CHECK ("organization_fiscal_settings"."icms_rate_bps" is null or ("organization_fiscal_settings"."icms_rate_bps" >= 0 and "organization_fiscal_settings"."icms_rate_bps" <= 10000));--> statement-breakpoint
ALTER TABLE "organization_fiscal_settings" ADD CONSTRAINT "org_fiscal_regime_source_check" CHECK ("organization_fiscal_settings"."tax_regime_source" is null or "organization_fiscal_settings"."tax_regime_source" in ('RECEITA','MANUAL'));--> statement-breakpoint
ALTER TABLE "organization_fiscal_settings" ADD CONSTRAINT "org_fiscal_mei_das_check" CHECK ("organization_fiscal_settings"."mei_das_cents" is null or "organization_fiscal_settings"."mei_das_cents" >= 0);--> statement-breakpoint
-- E51: a categoria de impostos passa a ser só a guia do imposto sobre o faturamento
-- (a DRE calcula esse imposto); taxas ganham categoria própria. Só renomeia quem
-- não mexeu no nome. As duas tabelas têm RLS FORÇADO: sem desligar o FORCE durante
-- a mudança, nem a dona delas alcança linha nenhuma e a migração passa calada
-- (mesmo desenho da 0028).
ALTER TABLE organizations NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE financial_categories NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
UPDATE financial_categories SET name = 'Impostos (DAS, ISS, PIS/COFINS)'
WHERE system_key = 'TAXES' AND name = 'Impostos e taxas';--> statement-breakpoint
INSERT INTO financial_categories (id, organization_id, direction, name, system_key)
SELECT gen_random_uuid(), o.id, 'PAYABLE', 'Taxas, alvará e IPTU', 'FEES'
FROM organizations o
ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE financial_categories FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
