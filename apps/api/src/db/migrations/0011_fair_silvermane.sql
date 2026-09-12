-- Orçamento: isolamento por oficina e provas imutáveis.

-- 1) Isolamento por oficina (DATABASE.md §2) nas seis tabelas novas.
--    `notifications` é por PESSOA dentro da oficina: o RLS isola o tenant, e o
--    filtro por user_id é do repositório — policy não substitui consulta certa.
SELECT app_enable_tenant_rls('quotes');
--> statement-breakpoint
SELECT app_enable_tenant_rls('quote_items');
--> statement-breakpoint
SELECT app_enable_tenant_rls('quote_attachments');
--> statement-breakpoint
SELECT app_enable_tenant_rls('quote_approvals');
--> statement-breakpoint
SELECT app_enable_tenant_rls('notifications');
--> statement-breakpoint
SELECT app_enable_tenant_rls('messages');
--> statement-breakpoint

-- 2) O que o cliente VIU e o que ele APROVOU não se edita nem se apaga.
--    Orçamento novo é versão nova (SUPERSEDED), nunca alteração do antigo:
--    é isso que faz a aprovação valer como prova na hora da entrega.
SELECT app_make_append_only('quote_items');
--> statement-breakpoint
SELECT app_make_append_only('quote_approvals');
