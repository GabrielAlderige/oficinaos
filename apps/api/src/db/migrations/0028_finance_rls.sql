-- Financeiro (E13): categorias padrão, isolamento por oficina e o elo com o
-- pagamento da OS (docs/DATABASE.md §2 e §6).

-- 1) As nove categorias padrão em toda oficina que já existe (as novas ganham
--    no cadastro). Isto vem ANTES de ligar o RLS: com RLS forçado, nem a dona
--    das tabelas consegue inserir sem contexto de oficina. Pelo mesmo motivo o
--    FORCE de organizations é desligado durante a leitura, como na 0007.
ALTER TABLE organizations NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
INSERT INTO financial_categories (id, organization_id, direction, name, system_key)
SELECT gen_random_uuid(), o.id, c.direction, c.name, c.key
FROM organizations o
CROSS JOIN (VALUES
  ('SERVICES', 'RECEIVABLE', 'Serviços e peças'),
  ('OTHER_INCOME', 'RECEIVABLE', 'Outras receitas'),
  ('PARTS', 'PAYABLE', 'Peças e insumos'),
  ('PAYROLL', 'PAYABLE', 'Salários e encargos'),
  ('RENT', 'PAYABLE', 'Aluguel'),
  ('UTILITIES', 'PAYABLE', 'Água, luz, internet'),
  ('TAXES', 'PAYABLE', 'Impostos e taxas'),
  ('TOOLS', 'PAYABLE', 'Ferramentas e manutenção'),
  ('OTHER_EXPENSE', 'PAYABLE', 'Outras despesas')
) AS c(key, direction, name)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- 2) Isolamento por oficina.
SELECT app_enable_tenant_rls('financial_categories');
--> statement-breakpoint
SELECT app_enable_tenant_rls('financial_entries');
--> statement-breakpoint
SELECT app_enable_tenant_rls('financial_settlements');
--> statement-breakpoint

-- 3) A coluna já esperava a E13 desde a E7 (pagamento de uma conta a receber).
--    A FK só pôde nascer agora, e mora aqui porque no schema do Drizzle ela
--    fecharia um ciclo de imports entre pagamento e financeiro.
ALTER TABLE "payments" ADD CONSTRAINT "payments_financial_entry_fk"
  FOREIGN KEY ("organization_id", "financial_entry_id") REFERENCES "financial_entries" ("organization_id", "id");
--> statement-breakpoint
CREATE INDEX "payments_financial_entry_idx" ON "payments" ("organization_id", "financial_entry_id");
