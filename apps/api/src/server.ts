import { buildApp } from './app';
import { readEnv } from './config/env';
import { loadEnv } from './config/load-env';
import { createDatabase } from './db/client';
import { createWorker } from './jobs/worker';

loadEnv();
const env = readEnv();
const { db, pool } = createDatabase(env.DATABASE_URL);
const app = await buildApp({ env, db });

/**
 * O trabalhador de fundo (E21) sobe junto com a API e é desligado antes dela.
 * Fica aqui, e não dentro do `buildApp`, porque teste não quer fila rodando
 * por baixo — `app.inject()` continua sendo só a API.
 */
const worker = createWorker({ env, log: app.log, automations: app.services.automations });
await worker.start();

async function shutdown(signal: string) {
  app.log.info({ signal }, 'encerrando');
  await worker.stop();
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
