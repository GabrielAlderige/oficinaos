import { buildApp } from './app';
import { readEnv } from './config/env';
import { loadEnv } from './config/load-env';
import { createDatabase } from './db/client';

loadEnv();
const env = readEnv();
const { db, pool } = createDatabase(env.DATABASE_URL);
const app = await buildApp({ env, db });

async function shutdown(signal: string) {
  app.log.info({ signal }, 'encerrando');
  await app.close();
  await pool.end();
  process.exit(0);
}
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ host: env.API_HOST, port: env.API_PORT });
} catch (err) {
  app.log.error({ err }, 'falha ao subir a API');
  await pool.end();
  process.exit(1);
}
