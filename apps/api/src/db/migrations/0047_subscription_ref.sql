-- Capacidade do aviso da assinatura (E20). O webhook do gateway chega SEM
-- oficina: quem diz de quem é a assinatura é o id dela no gateway. Mesmo
-- desenho do link do orçamento (0012) e da cobrança (0044).
CREATE OR REPLACE FUNCTION app_current_subscription_ref() RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT nullif(current_setting('app.subscription_provider_ref', true), '')
$$;
--> statement-breakpoint

CREATE POLICY subscription_by_provider_ref ON subscriptions FOR SELECT
  USING (provider_subscription_id IS NOT NULL
         AND provider_subscription_id = (SELECT app_current_subscription_ref()));
