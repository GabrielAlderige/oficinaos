-- Oferta "Oficina Pronta" (D92): o teste de 30 dias começa na implantação ou
-- no primeiro orçamento enviado, não no cadastro; e as fundadoras têm o preço
-- do Nitro travado.

ALTER TABLE "subscriptions" ADD COLUMN "trial_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "setup_done_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "founder_price_cents" bigint;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "founder_price_until" timestamp with time zone;;--> statement-breakpoint

-- Quem já existia começou o teste no cadastro (a regra antiga, dos 14 dias):
-- fica marcado como começado, e o fim gravado não muda. Sem isto, a oficina
-- antiga apareceria "esperando a implantação" e ganharia 30 dias novos no
-- próximo orçamento.
-- A tabela tem RLS forçado: sem o contexto de plataforma (a política
-- platform_extends_trial, da 0065), este UPDATE não alcançaria linha nenhuma
-- e passaria calado.
SELECT set_config('app.platform_admin', 'on', false);
--> statement-breakpoint
UPDATE "subscriptions" SET "trial_started_at" = "created_at" WHERE "trial_started_at" IS NULL;
--> statement-breakpoint
SELECT set_config('app.platform_admin', '', false);
--> statement-breakpoint

-- O painel da plataforma mostra quem está parado há dias sem abrir OS: é para
-- quem ligar antes de a oficina desistir. Mesmo desenho da 0065 — a leitura só
-- abre com `app.platform_admin = on`, que só é marcado em rota de plataforma, e
-- a API só tira de lá a contagem e a data da última OS.
--
-- (A política platform_extends_trial, da 0065, passa a cobrir também a
-- implantação feita e a fundadora: as duas gravam na mesma linha da
-- assinatura, pela API, com registro na trilha da oficina.)
CREATE POLICY platform_reads_work_orders ON work_orders
  FOR SELECT
  USING (current_setting('app.platform_admin', true) = 'on');
