import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { v7 as uuidv7 } from 'uuid';
import type { Env } from './config/env';
import type { Database } from './db/client';
import { registerErrorHandling } from './core/plugins/error-handler';
import { registerSecurity } from './core/plugins/security';
import { systemRoutes } from './modules/system/system.routes';

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
    env: Env;
  }
}

export interface AppDeps {
  env: Env;
  db: Database;
}

/** Monta a API sem abrir porta: o server.ts escuta; os testes usam `app.inject()`. */
export async function buildApp({ env, db }: AppDeps) {
  const app = Fastify({
    logger:
      env.NODE_ENV === 'test'
        ? false
        : {
            level: env.LOG_LEVEL,
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'res.headers["set-cookie"]',
                '*.password',
                '*.passwordHash',
                '*.token',
                '*.refreshToken',
              ],
              censor: '[redacted]',
            },
          },
    genReqId: () => uuidv7(),
    bodyLimit: 1_048_576,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.decorate('db', db);
  app.decorate('env', env);

  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  registerErrorHandling(app);
  await registerSecurity(app, env);

  await app.register(systemRoutes, { prefix: '/api/v1' });

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
