-- Cobrança online (E19): isolamento por oficina e a capacidade do aviso do
-- gateway (docs/DATABASE.md §2).

SELECT app_enable_tenant_rls('charges');
--> statement-breakpoint
SELECT app_enable_tenant_rls('payment_webhook_events');
--> statement-breakpoint

-- O webhook chega SEM oficina: quem diz de quem é o dinheiro é o id da
-- cobrança no gateway. Mesmo desenho do link do orçamento (migration 0012):
-- quem apresenta a referência lê EXATAMENTE aquela linha, e o resto do
-- trabalho roda depois com contexto normal de oficina.
CREATE OR REPLACE FUNCTION app_current_charge_ref() RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT nullif(current_setting('app.charge_provider_ref', true), '')
$$;
--> statement-breakpoint

CREATE POLICY charge_by_provider_ref ON charges FOR SELECT
  USING (provider_charge_id IS NOT NULL AND provider_charge_id = (SELECT app_current_charge_ref()));
