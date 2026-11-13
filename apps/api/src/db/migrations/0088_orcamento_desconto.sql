-- Orçamento com desconto: a regra do desconto da OS passa a ser congelada no envio.
-- Os orçamentos que já existem ficam com totals_frozen = false e NÃO são
-- reescritos: são a prova do que o cliente viu (desconto 0, total = subtotal).
ALTER TABLE "quotes" ADD COLUMN "discount_mode" text;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "discount_value" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "totals_frozen" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_discount_rule_check" CHECK (("quotes"."discount_mode" is null or "quotes"."discount_mode" in ('AMOUNT','PERCENT')) and "quotes"."discount_value" >= 0 and "quotes"."discount_cents" <= "quotes"."subtotal_cents");