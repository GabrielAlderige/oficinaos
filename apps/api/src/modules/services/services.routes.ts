import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  createServiceSchema,
  idParamSchema,
  paginated,
  serviceListQuerySchema,
  serviceSchema,
  updateServiceSchema,
} from '@oficinaos/shared';
import { clientInfo, getAuth } from '../../core/auth-context';

export const serviceRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = app.services.catalogServices;

  app.get(
    '/',
    {
      config: { auth: 'catalog:read' },
      schema: { querystring: serviceListQuerySchema, response: { 200: paginated(serviceSchema) } },
    },
    async (request) => service.list(getAuth(request), request.query),
  );

  app.post(
    '/',
    { config: { auth: 'catalog:write' }, schema: { body: createServiceSchema, response: { 201: serviceSchema } } },
    async (request, reply) => {
      reply.code(201);
      return service.create(getAuth(request), request.body, clientInfo(request));
    },
  );

  app.get(
    '/:id',
    { config: { auth: 'catalog:read' }, schema: { params: idParamSchema, response: { 200: serviceSchema } } },
    async (request) => service.get(getAuth(request), request.params.id),
  );

  app.patch(
    '/:id',
    {
      config: { auth: 'catalog:write' },
      schema: { params: idParamSchema, body: updateServiceSchema, response: { 200: serviceSchema } },
    },
    async (request) => service.update(getAuth(request), request.params.id, request.body, clientInfo(request)),
  );

  app.delete(
    '/:id',
    { config: { auth: 'catalog:write' }, schema: { params: idParamSchema } },
    async (request, reply) => {
      await service.remove(getAuth(request), request.params.id, clientInfo(request));
      return reply.code(204).send();
    },
  );
};
