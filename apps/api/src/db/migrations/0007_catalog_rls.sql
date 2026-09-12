-- Catálogo e estoque: categorias padrão para as oficinas que já existem,
-- isolamento por oficina e livro-razão imutável.

-- 1) As 11 categorias do briefing em toda oficina existente (as novas ganham no cadastro).
--    Com RLS FORCE, nem a dona das tabelas lê organizations sem contexto: o FORCE é
--    desligado só durante esta leitura e religado logo em seguida, na mesma transação.
ALTER TABLE organizations NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
INSERT INTO part_categories (id, organization_id, name, position)
SELECT gen_random_uuid(), o.id, c.name, c.position
FROM organizations o
CROSS JOIN (VALUES
  ('Motor', 1), ('Freios', 2), ('Suspensão', 3), ('Elétrica', 4), ('Transmissão', 5),
  ('Filtros', 6), ('Lubrificantes', 7), ('Pneus', 8), ('Arrefecimento', 9),
  ('Direção', 10), ('Acessórios', 11)
) AS c(name, position)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- 2) Isolamento por oficina (DATABASE.md §2).
SELECT app_enable_tenant_rls('services');
--> statement-breakpoint
SELECT app_enable_tenant_rls('part_categories');
--> statement-breakpoint
SELECT app_enable_tenant_rls('parts');
--> statement-breakpoint
SELECT app_enable_tenant_rls('part_applications');
--> statement-breakpoint
SELECT app_enable_tenant_rls('inventory_movements');
--> statement-breakpoint

-- 3) O livro-razão do estoque não se edita nem se apaga: correção é um movimento novo.
SELECT app_make_append_only('inventory_movements');
