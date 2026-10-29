import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { idParamSchema, publicPortalSchema, reviewInviteResultSchema } from '@oficinaos/shared';
import { clientInfo, getAuth } from '../../core/auth-context';

/** O link do app do cliente sai da ficha do cliente (E50): quem fala com ele manda. */
export const customerPortalRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/:id/portal-link',
    { config: { auth: 'customers:view_contact' }, schema: { params: idParamSchema, response: { 201: reviewInviteResultSchema } } },
    async (request, reply) => {
      reply.code(201);
      return app.services.portal.link(getAuth(request), request.params.id, clientInfo(request));
    },
  );
};

/** A página do cliente, sem login. Mesmo teto por IP das outras páginas públicas. */
export const publicPortalRoutes: FastifyPluginAsyncZod = async (app) => {
  const tokenParam = z.object({ token: z.string().min(16).max(128) });

  app.get(
    '/portal/:token',
    {
      config: { auth: 'public', rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: { params: tokenParam, response: { 200: publicPortalSchema } },
    },
    async (request) => app.services.portal.publicView(request.params.token),
  );

  app.get(
    '/portal/:token/manifest.webmanifest',
    { config: { auth: 'public', rateLimit: { max: 60, timeWindow: '1 minute' } }, schema: { params: tokenParam } },
    async (request, reply) => {
      reply.header('content-type', 'application/manifest+json; charset=utf-8');
      return app.services.portal.manifest(request.params.token);
    },
  );
};
