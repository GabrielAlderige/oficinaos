import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { sampleDataStatusSchema } from '@oficinaos/shared';
import { clientInfo, getAuth } from '../../core/auth-context';

/**
 * Dados de exemplo (D92). Quem configura a oficina decide: é a mesma
 * permissão dos dados da oficina, porque encher e esvaziar o cadastro mexe na
 * oficina inteira.
 */
export const sampleDataRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = app.services.sampleData;

  app.get(
    '/',
    { config: { auth: 'organization:manage' }, schema: { response: { 200: sampleDataStatusSchema } } },
    async (request) => service.status(getAuth(request)),
  );

  app.post(
    '/',
    { config: { auth: 'organization:manage' }, schema: { response: { 200: sampleDataStatusSchema } } },
    async (request) => service.load(getAuth(request), clientInfo(request)),
  );

  app.delete(
    '/',
    { config: { auth: 'organization:manage' }, schema: { response: { 200: sampleDataStatusSchema } } },
    async (request) => service.clear(getAuth(request), clientInfo(request)),
  );
};
