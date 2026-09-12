import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { idParamSchema, notificationListQuerySchema, notificationListSchema } from '@oficinaos/shared';
import { getAuth } from '../../core/auth-context';

/**
 * O sino do painel. `authenticated` e não uma permissão: o aviso é de quem o
 * recebeu — até o mecânico vê os seus, e ninguém vê os dos outros.
 */
export const notificationRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = app.services.notifications;

  app.get(
    '/',
    {
      config: { auth: 'authenticated' },
      schema: { querystring: notificationListQuerySchema, response: { 200: notificationListSchema } },
    },
    async (request) => service.list(getAuth(request), request.query),
  );

  app.post(
    '/read',
    { config: { auth: 'authenticated' }, schema: { response: { 200: notificationListSchema } } },
    async (request) => service.markAllRead(getAuth(request)),
  );

  app.post(
    '/:id/read',
    { config: { auth: 'authenticated' }, schema: { params: idParamSchema } },
    async (request, reply) => {
      await service.markRead(getAuth(request), request.params.id);
      return reply.code(204).send();
    },
  );
};
