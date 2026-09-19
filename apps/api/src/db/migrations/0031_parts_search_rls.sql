-- Pesquisa de peças (E14): isolamento por oficina (docs/DATABASE.md §2).
SELECT app_enable_tenant_rls('supplier_price_list_items');
--> statement-breakpoint
SELECT app_enable_tenant_rls('part_search_queries');
--> statement-breakpoint
SELECT app_enable_tenant_rls('part_offers');
--> statement-breakpoint

-- A oferta é o que o provider respondeu NAQUELE instante: não se edita depois.
-- Mudou o preço? É outra busca, com outro `fetched_at` — é assim que o custo de
-- uma peça continua explicável meses depois.
SELECT app_make_append_only('part_offers');
