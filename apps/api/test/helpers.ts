import { afterAll } from 'vitest';
import { loadEnv } from '../src/config/load-env';
import { readEnv, type Env } from '../src/config/env';
import { createDatabase, type DatabaseHandle } from '../src/db/client';

loadEnv();

let handle: DatabaseHandle | undefined;

/** Banco de teste conectado como a role da APLICAÇÃO (sujeita ao RLS), como em produção. */
export function testDb(): DatabaseHandle {
  if (!handle) {
    const url = process.env.TEST_DATABASE_URL;
    if (!url) throw new Error('Falta TEST_DATABASE_URL no .env');
    handle = createDatabase(url, { max: 4 });
    afterAll(async () => {
      await handle?.pool.end();
      handle = undefined;
    });
  }
  return handle;
}

export function testEnv(overrides: Partial<NodeJS.ProcessEnv> = {}): Env {
  return readEnv({
    NODE_ENV: 'test',
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    ...overrides,
  });
}
