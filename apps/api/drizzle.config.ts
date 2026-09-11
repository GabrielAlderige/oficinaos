import { defineConfig } from 'drizzle-kit';
import { loadEnv } from './src/config/load-env';

loadEnv();

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
  casing: 'snake_case',
  // migrations rodam como dona das tabelas, nunca como a role da aplicação
  dbCredentials: { url: process.env.DATABASE_OWNER_URL ?? '' },
  strict: true,
  verbose: true,
});
