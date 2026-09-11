/**
 * Teste de guarda do isolamento (docs/DATABASE.md §2). Falha se alguém criar
 * uma tabela de tenant sem RLS, ou se a API estiver conectando com uma role
 * capaz de ignorar o RLS.
 */
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { testDb } from './helpers';

// Tabelas globais de propósito, sem RLS de tenant (só o módulo de auth as acessa).
const GLOBAL_TABLES = new Set(['users']);

describe('guarda do RLS', () => {
  const { db } = testDb();

  it('a API conecta com uma role que não ignora o RLS', async () => {
    const { rows } = await db.execute<{ rolsuper: boolean; rolbypassrls: boolean }>(
      sql`select rolsuper, rolbypassrls from pg_roles where rolname = current_user`,
    );
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it('toda tabela de tenant tem RLS habilitado, forçado e com policy', async () => {
    const { rows } = await db.execute<{
      table: string;
      has_org_column: boolean;
      rls: boolean;
      forced: boolean;
      policies: number;
    }>(sql`
      select c.relname as table,
             exists (select 1 from pg_attribute a
                     where a.attrelid = c.oid and a.attname = 'organization_id' and not a.attisdropped) as has_org_column,
             c.relrowsecurity as rls,
             c.relforcerowsecurity as forced,
             (select count(*)::int from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p')
    `);

    expect(rows.length).toBeGreaterThan(0);
    const tenantTables = rows.filter((r) => r.has_org_column || r.table === 'organizations');
    const unprotected = tenantTables
      .filter((r) => !(r.rls && r.forced && r.policies > 0))
      .map((r) => r.table);
    expect(unprotected, 'tabelas de tenant sem RLS').toEqual([]);

    const unknown = rows
      .filter((r) => !r.has_org_column && r.table !== 'organizations' && !GLOBAL_TABLES.has(r.table))
      .map((r) => r.table);
    expect(unknown, 'tabela nova sem organization_id: é global? registre em GLOBAL_TABLES').toEqual([]);
  });

  it('a auditoria é append-only para a aplicação', async () => {
    const { rows } = await db.execute<{ can_update: boolean; can_delete: boolean }>(sql`
      select has_table_privilege(current_user, 'activity_logs', 'UPDATE') as can_update,
             has_table_privilege(current_user, 'activity_logs', 'DELETE') as can_delete
    `);
    expect(rows[0]).toEqual({ can_update: false, can_delete: false });
  });
});
