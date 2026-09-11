import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { organizationSchema, updateOrganizationSchema } from '@oficinaos/shared';
import { clientInfo, getAuth } from '../../core/auth-context';

/** A oficina do contexto (singular: o tenant vem do token, nunca da URL). */
export const organizationRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = app.services.organizations;

  app.get(
    '/',
    { config: { auth: 'authenticated' }, schema: { response: { 200: organizationSchema } } },
    async (request) => service.get(getAuth(request)),
  );

  app.patch(
    '/',
    {
      config: { auth: 'organization:manage' },
      schema: { body: updateOrganizationSchema, response: { 200: organizationSchema } },
    },
    async (request) => service.update(getAuth(request), request.body, clientInfo(request)),
  );
};
