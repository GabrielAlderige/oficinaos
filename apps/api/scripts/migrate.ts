/**
 * Aplica as migrations como dona das tabelas.
 *   npm run db:migrate            → banco de desenvolvimento (DATABASE_OWNER_URL)
 *   npm run db:migrate -- --test  → banco de teste (TEST_DATABASE_OWNER_URL)
 */
import { resolve } from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { loadEnv } from '../src/config/load-env';
import { createDatabase } from '../src/db/client';

loadEnv();

export const MIGRATIONS_FOLDER = resolve(import.meta.dirname, '../src/db/migrations');

export async function runMigrations(url: string): Promise<void> {
  const { db, pool } = createDatabase(url, { max: 1 });
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await pool.end();
  }
}

const isEntrypoint = process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename);
if (isEntrypoint) {
  const variable = process.argv.includes('--test') ? 'TEST_DATABASE_OWNER_URL' : 'DATABASE_OWNER_URL';
  const url = process.env[variable];
  if (!url) throw new Error(`Falta ${variable} no .env`);
  await runMigrations(url);
  console.log(`Migrations aplicadas (${variable}).`);
}
