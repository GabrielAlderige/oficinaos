-- App do cliente (E50): capacidade do link, com o mesmo desenho do orçamento
-- (0012) e da avaliação (0035). Quem apresenta o HASH do token lê EXATAMENTE
-- aquele cliente, para a API descobrir de que oficina ele é. Todo o resto roda
-- depois com o contexto normal da oficina.
CREATE OR REPLACE FUNCTION app_current_portal_token() RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT nullif(current_setting('app.portal_token_hash', true), '')
$$;
--> statement-breakpoint

CREATE POLICY customer_by_portal_token ON customers FOR SELECT
  USING (portal_token_hash = (SELECT app_current_portal_token()));
