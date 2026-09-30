import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { createPackageSchema, idParamSchema, servicePackageSchema, updatePackageSchema } from '@oficinaos/shared';
import { clientInfo, getAuth } from '../../core/auth-context';

/**
 * Pacotes de serviço (E27). Montar pacote é mexer no catálogo, então segue a
 * mesma permissão dele: quem cadastra serviço monta pacote.
 */
export const packageRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = app.services.packages;

  app.get(
    '/',
    {
      config: { auth: 'catalog:read', feature: 'service_packages' },
      schema: {
        querystring: z.object({ incluirInativos: z.stringbool().default(false) }),
        response: { 200: z.object({ data: z.array(servicePackageSchema) }) },
      },
    },
    async (request) => ({ data: await service.list(getAuth(request), request.query.incluirInativos) }),
  );

  app.get(
    '/:id',
    { config: { auth: 'catalog:read', feature: 'service_packages' }, schema: { params: idParamSchema, response: { 200: servicePackageSchema } } },
    async (request) => service.get(getAuth(request), request.params.id),
  );

  app.post(
    '/',
    {
      config: { auth: 'catalog:write', feature: 'service_packages' },
      schema: { body: createPackageSchema, response: { 201: servicePackageSchema } },
    },
    async (request, reply) => {
      const pacote = await service.create(getAuth(request), request.body, clientInfo(request));
      return reply.code(201).send(pacote);
    },
  );

  app.patch(
    '/:id',
    {
      config: { auth: 'catalog:write', feature: 'service_packages' },
      schema: { params: idParamSchema, body: updatePackageSchema, response: { 200: servicePackageSchema } },
    },
    async (request) => service.update(getAuth(request), request.params.id, request.body, clientInfo(request)),
  );

  app.delete(
    '/:id',
    {
      config: { auth: 'catalog:write', feature: 'service_packages' },
      schema: { params: idParamSchema, response: { 200: z.object({ ok: z.literal(true) }) } },
    },
    async (request) => {
      await service.remove(getAuth(request), request.params.id, clientInfo(request));
      return { ok: true as const };
    },
  );
};
