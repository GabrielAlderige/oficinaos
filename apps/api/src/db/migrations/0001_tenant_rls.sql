-- Isolamento por oficina (docs/DATABASE.md §2).
-- Toda tabela de tenant tem RLS habilitado E forçado (vale até para a dona das
-- tabelas), com a policy comparando organization_id ao contexto da transação,
-- definido por withTenant() com set_config('app.org_id', …, true).
-- Sem contexto, app_current_org() é NULL e nenhuma linha é visível: falha fechado.

CREATE OR REPLACE FUNCTION app_current_org() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT nullif(current_setting('app.org_id', true), '')::uuid
$$;
--> statement-breakpoint

-- Aplica o padrão de isolamento a uma tabela com coluna organization_id.
-- Toda migration que cria tabela de tenant chama esta função (o teste de guarda cobra).
CREATE OR REPLACE FUNCTION app_enable_tenant_rls(target regclass) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', target);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', target);
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %s', target);
  -- (SELECT …) vira InitPlan: a função roda uma vez por consulta, não por linha
  EXECUTE format(
    'CREATE POLICY tenant_isolation ON %s '
    'USING (organization_id = (SELECT app_current_org())) '
    'WITH CHECK (organization_id = (SELECT app_current_org()))',
    target
  );
END
$$;
--> statement-breakpoint

-- Tira UPDATE, DELETE e TRUNCATE de todas as roles (exceto a dona): histórico imutável.
CREATE OR REPLACE FUNCTION app_make_append_only(target regclass) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  grantee_role text;
BEGIN
  FOR grantee_role IN
    SELECT DISTINCT g.grantee
    FROM information_schema.role_table_grants g
    JOIN pg_class c ON c.oid = target
    WHERE g.table_schema = 'public'
      AND g.table_name = c.relname
      AND g.privilege_type IN ('UPDATE', 'DELETE', 'TRUNCATE')
      AND g.grantee <> current_user
  LOOP
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %s FROM %I', target, grantee_role);
  END LOOP;
END
$$;
--> statement-breakpoint

-- As funções de manutenção não são para a aplicação.
REVOKE EXECUTE ON FUNCTION app_enable_tenant_rls(regclass) FROM PUBLIC;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app_make_append_only(regclass) FROM PUBLIC;
--> statement-breakpoint

-- organizations é o próprio tenant: compara o id, não organization_id.
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON organizations
  USING (id = (SELECT app_current_org()))
  WITH CHECK (id = (SELECT app_current_org()));
--> statement-breakpoint

SELECT app_enable_tenant_rls('memberships');
--> statement-breakpoint
SELECT app_enable_tenant_rls('activity_logs');
--> statement-breakpoint
SELECT app_make_append_only('activity_logs');
