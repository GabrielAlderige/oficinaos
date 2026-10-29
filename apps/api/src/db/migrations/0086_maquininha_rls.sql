-- Maquininha (E50): isolamento por oficina e a capacidade do aviso da Stone.
SELECT app_enable_tenant_rls('pos_settings');
--> statement-breakpoint
SELECT app_enable_tenant_rls('pos_charges');
--> statement-breakpoint

-- O aviso da Stone chega SEM oficina: quem diz de quem é o dinheiro é o id do
-- pedido na Pagar.me. Mesmo desenho da cobrança online (migration 0044): quem
-- apresenta a referência lê EXATAMENTE aquela cobrança e a configuração da
-- oficina dona dela (para consultar a Stone com a chave certa), e nada mais.
CREATE OR REPLACE FUNCTION app_current_pos_order_ref() RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT nullif(current_setting('app.pos_order_ref', true), '')
$$;
--> statement-breakpoint

CREATE POLICY pos_charge_by_order_ref ON pos_charges FOR SELECT
  USING (provider_order_id IS NOT NULL AND provider_order_id = (SELECT app_current_pos_order_ref()));
