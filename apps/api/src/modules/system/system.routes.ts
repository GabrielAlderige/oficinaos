import { sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { healthResponseSchema, readyResponseSchema } from '@oficinaos/shared';

const VERSION = process.env.APP_VERSION ?? 'dev';

/** Sondas do orquestrador: `/health` = o processo está vivo; `/ready` = consegue falar com o banco. */
export const systemRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/health',
    { config: { auth: 'public' }, schema: { response: { 200: healthResponseSchema } } },
    async () => ({ status: 'ok' as const, version: VERSION }),
  );

  app.get(
    '/ready',
    {
      config: { auth: 'public' },
      schema: { response: { 200: readyResponseSchema, 503: readyResponseSchema } },
    },
    async (request, reply) => {
      const started = performance.now();
      try {
        await app.db.execute(sql`select 1`);
        return {
          status: 'ok' as const,
          database: 'ok' as const,
          latencyMs: Math.round(performance.now() - started),
        };
      } catch (err) {
        request.log.error({ err }, 'banco de dados indisponível');
        return reply.code(503).send({ status: 'unavailable', database: 'unavailable' });
      }
    },
  );
};
