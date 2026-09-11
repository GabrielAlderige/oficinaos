import pg from 'pg';
import { loadEnv } from '../src/config/load-env';
import { runMigrations } from '../scripts/migrate';

/**
 * Antes da suíte: migrations no banco de teste e dados zerados.
 * Roda como dona das tabelas; os testes em si usam a role da aplicação.
 */
export default async function setup() {
  loadEnv();
  const url = process.env.TEST_DATABASE_OWNER_URL;
  if (!url) throw new Error('Falta TEST_DATABASE_OWNER_URL no .env');

  await runMigrations(url);

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query<{ tablename: string }>(
      `select tablename from pg_tables where schemaname = 'public'`,
    );
    if (rows.length) {
      const tables = rows.map((r) => `"${r.tablename}"`).join(', ');
      await client.query(`TRUNCATE ${tables} CASCADE`);
    }
  } finally {
    await client.end();
  }
}
