-- Pós-venda, avaliações e CRM (E16): isolamento por oficina e o link público
-- da avaliação (docs/DATABASE.md §2).

SELECT app_enable_tenant_rls('follow_ups');
--> statement-breakpoint
SELECT app_enable_tenant_rls('reviews');
--> statement-breakpoint
SELECT app_enable_tenant_rls('leads');
--> statement-breakpoint

-- Capacidade do link da avaliação, com o mesmo desenho do orçamento
-- (migration 0012): quem apresenta o HASH do token lê EXATAMENTE aquela linha,
-- para a API descobrir de que oficina ela é. Todo o resto roda depois com
-- contexto normal. O link vai por WhatsApp e pode ser encaminhado: ele prova
-- "alguém tem o endereço desta avaliação", não "alguém é o cliente".
CREATE OR REPLACE FUNCTION app_current_review_token() RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT nullif(current_setting('app.review_token_hash', true), '')
$$;
--> statement-breakpoint

CREATE POLICY review_by_token ON reviews FOR SELECT
  USING (token_hash = (SELECT app_current_review_token()));
