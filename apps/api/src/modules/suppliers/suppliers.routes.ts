import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  idParamSchema,
  paginated,
  supplierFormSchema,
  supplierListItemSchema,
  supplierListQuerySchema,
  supplierSchema,
  updateSupplierSchema,
} from '@oficinaos/shared';
import { clientInfo, getAuth } from '../../core/auth-context';

/**
 * Fornecedores (docs/API.md, MVP 2). Tirar da lista também é `suppliers:write`:
 * é soft delete e o histórico fica, então não pede permissão à parte como o
 * cliente pede.
 */
export const supplierRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = app.services.suppliers;

  app.get(
    '/',
    {
      config: { auth: 'suppliers:read' },
      schema: { querystring: supplierListQuerySchema, response: { 200: paginated(supplierListItemSchema) } },
    },
    async (request) => service.list(getAuth(request), request.query),
  );

  app.post(
    '/',
    {
      config: { auth: 'suppliers:write' },
      schema: { body: supplierFormSchema, response: { 201: supplierSchema } },
    },
    async (request, reply) => {
      reply.code(201);
      return service.create(getAuth(request), request.body, clientInfo(request));
    },
  );

  app.get(
    '/:id',
    {
      config: { auth: 'suppliers:read' },
      schema: { params: idParamSchema, response: { 200: supplierSchema } },
    },
    async (request) => service.get(getAuth(request), request.params.id),
  );

  app.patch(
    '/:id',
    {
      config: { auth: 'suppliers:write' },
      schema: { params: idParamSchema, body: updateSupplierSchema, response: { 200: supplierSchema } },
    },
    async (request) => service.update(getAuth(request), request.params.id, request.body, clientInfo(request)),
  );

  app.delete(
    '/:id',
    {
      config: { auth: 'suppliers:write' },
      schema: { params: idParamSchema, response: { 204: z.null() } },
    },
    async (request, reply) => {
      await service.remove(getAuth(request), request.params.id, clientInfo(request));
      return reply.code(204).send(null);
    },
  );
};
