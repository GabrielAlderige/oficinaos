import pg from 'pg';
import { loadEnv } from '../src/config/load-env';
import { runMigrations } from '../scripts/migrate';

/**
 * Antes da suíte: o banco de teste é RECRIADO a partir das migrations.
 *
 * Isso garante dado de referência intacto (planos vêm da migration 0003) e
 * prova, a cada execução, que as migrations sobem do zero. O schema `public`
 * é mantido: os privilégios padrão da role da aplicação (db:setup) estão
 * amarrados a ele. Roda como dona das tabelas.
 */
export default async function setup() {
  loadEnv();
  const url = process.env.TEST_DATABASE_OWNER_URL;
  if (!url) throw new Error('Falta TEST_DATABASE_OWNER_URL no .env');

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const database = (await client.query<{ db: string }>('select current_database() as db')).rows[0]?.db;
    if (!database?.endsWith('_test')) {
      throw new Error(`Recuso recriar "${database}": o banco de teste precisa terminar em _test`);
    }

    const { rows: tables } = await client.query<{ tablename: string }>(
      `select tablename from pg_tables where schemaname = 'public'`,
    );
    if (tables.length) {
      await client.query(`DROP TABLE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`);
    }

    const { rows: functions } = await client.query<{ signature: string }>(
      `select p.oid::regprocedure::text as signature
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname like 'app\\_%'`,
    );
    for (const fn of functions) await client.query(`DROP FUNCTION IF EXISTS ${fn.signature} CASCADE`);

    await client.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
  } finally {
    await client.end();
  }

  await runMigrations(url);
}
