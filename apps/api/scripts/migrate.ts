/**
 * Aplica as migrations como dona das tabelas.
 *   npm run db:migrate            → banco de desenvolvimento (DATABASE_OWNER_URL)
 *   npm run db:migrate -- --test  → banco de teste (TEST_DATABASE_OWNER_URL)
 */
import { resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { getConstructionPlans } from 'pg-boss';
import { loadEnv } from '../src/config/load-env';
import { createDatabase, type Database } from '../src/db/client';

loadEnv();

export const MIGRATIONS_FOLDER = resolve(import.meta.dirname, '../src/db/migrations');

export async function runMigrations(url: string): Promise<void> {
  const { db, pool } = createDatabase(url, { max: 1 });
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    await instalarFilaDeJobs(db, appRole(url));
  } finally {
    await pool.end();
  }
}

/** A role da aplicação, tirada da URL dela (a dona é outra). */
function appRole(ownerUrl: string): string {
  const app = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;
  return new URL(app ?? ownerUrl).username;
}

/**
 * A fila de jobs (E21) vive no esquema `pgboss`, e é instalada AQUI — pela
 * dona, junto das migrations — e não pelo pg-boss no boot da API.
 *
 * Motivo: criar e migrar tabela é trabalho de dona. Se a API fizesse isso, a
 * role que atende requisição precisaria de poder de DDL no banco inteiro, e
 * o isolamento das oficinas passaria a depender de disciplina, não de
 * permissão. O SQL vem da própria biblioteca (`getConstructionPlans`), porque
 * ele muda com a versão dela — por isso não é um arquivo .sql do repositório.
 */
async function instalarFilaDeJobs(db: Database, role: string): Promise<void> {
  await db.execute(sql.raw('CREATE SCHEMA IF NOT EXISTS pgboss'));
  const jaExiste = await db.execute<{ existe: boolean }>(
    sql.raw(`select exists (select 1 from pg_tables where schemaname = 'pgboss' and tablename = 'job') as existe`),
  );
  if (!jaExiste.rows[0]?.existe) {
    await db.execute(sql.raw(getConstructionPlans('pgboss', { createSchema: false })));
  }
  // a aplicação usa a fila, mas não a constrói
  await db.execute(sql.raw(`GRANT USAGE ON SCHEMA pgboss TO "${role}"`));
  await db.execute(sql.raw(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgboss TO "${role}"`));
  await db.execute(sql.raw(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA pgboss TO "${role}"`));
  await db.execute(sql.raw(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pgboss TO "${role}"`));
}

const isEntrypoint = process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename);
if (isEntrypoint) {
  const variable = process.argv.includes('--test') ? 'TEST_DATABASE_OWNER_URL' : 'DATABASE_OWNER_URL';
  const url = process.env[variable];
  if (!url) throw new Error(`Falta ${variable} no .env`);
  await runMigrations(url);
  console.log(`Migrations aplicadas (${variable}).`);
}
