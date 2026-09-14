-- Cotação com fornecedores: isolamento por oficina (docs/DATABASE.md §2).
SELECT app_enable_tenant_rls('supplier_quote_requests');
--> statement-breakpoint
SELECT app_enable_tenant_rls('supplier_quote_request_items');
--> statement-breakpoint
SELECT app_enable_tenant_rls('supplier_quote_invites');
--> statement-breakpoint
SELECT app_enable_tenant_rls('supplier_quote_responses');
--> statement-breakpoint
SELECT app_enable_tenant_rls('supplier_quote_response_items');
--> statement-breakpoint
SELECT app_enable_tenant_rls('supplier_quote_awards');
--> statement-breakpoint
SELECT app_enable_tenant_rls('part_price_history');
--> statement-breakpoint

-- A resposta do fornecedor é PROVA ("você me passou R$ X no dia Y"), e o
-- histórico de preço também: a aplicação não altera nem apaga. Corrigir é uma
-- versão nova, não um UPDATE.
SELECT app_make_append_only('supplier_quote_responses');
--> statement-breakpoint
SELECT app_make_append_only('supplier_quote_response_items');
--> statement-breakpoint
SELECT app_make_append_only('part_price_history');
--> statement-breakpoint

-- Capacidade do link do fornecedor (mesmo desenho do convite, migration 0003).
--
-- Quem apresenta o HASH do token lê EXATAMENTE uma linha: o convite daquele
-- fornecedor, para a API descobrir de que oficina ele é. Itens, resposta, aviso
-- e timeline rodam depois com o contexto normal de oficina.
--
-- O banco guarda só o hash: ler a tabela não entrega um link que funcione, e
-- portanto não permite cotar em nome de fornecedor nenhum.
CREATE OR REPLACE FUNCTION app_current_supplier_token_hash() RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT nullif(current_setting('app.supplier_token_hash', true), '')
$$;
--> statement-breakpoint

CREATE POLICY supplier_invite_by_token ON supplier_quote_invites FOR SELECT
  USING (token_hash = (SELECT app_current_supplier_token_hash()));
