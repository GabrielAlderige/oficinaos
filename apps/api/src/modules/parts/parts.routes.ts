import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  createPartSchema,
  idParamSchema,
  inventorySummarySchema,
  movementResultSchema,
  movementSchema,
  paginated,
  partApplicationInputSchema,
  partApplicationSchema,
  partCategoryInputSchema,
  partCategorySchema,
  partListItemSchema,
  partListQuerySchema,
  partSchema,
  stockMovementInputSchema,
  updatePartSchema,
} from '@oficinaos/shared';
import { clientInfo, getAuth } from '../../core/auth-context';

export const partRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = app.services.parts;

  app.get(
    '/',
    {
      config: { auth: 'catalog:read' },
      schema: { querystring: partListQuerySchema, response: { 200: paginated(partListItemSchema) } },
    },
    async (request) => service.list(getAuth(request), request.query),
  );

  app.post(
    '/',
    { config: { auth: 'catalog:write' }, schema: { body: createPartSchema, response: { 201: partSchema } } },
    async (request, reply) => {
      reply.code(201);
      return service.create(getAuth(request), request.body, clientInfo(request));
    },
  );

  app.get(
    '/:id',
    { config: { auth: 'catalog:read' }, schema: { params: idParamSchema, response: { 200: partSchema } } },
    async (request) => service.get(getAuth(request), request.params.id),
  );

  app.patch(
    '/:id',
    {
      config: { auth: 'catalog:write' },
      schema: { params: idParamSchema, body: updatePartSchema, response: { 200: partSchema } },
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

  app.get(
    '/:id/movements',
    {
      config: { auth: 'inventory:read' },
      schema: { params: idParamSchema, response: { 200: z.object({ data: z.array(movementSchema) }) } },
    },
    async (request) => ({ data: await service.movements(getAuth(request), request.params.id) }),
  );

  app.get(
    '/:id/applications',
    {
      config: { auth: 'catalog:read' },
      schema: { params: idParamSchema, response: { 200: z.object({ data: z.array(partApplicationSchema) }) } },
    },
    async (request) => ({ data: await service.applications(getAuth(request), request.params.id) }),
  );

  app.post(
    '/:id/applications',
    {
      config: { auth: 'catalog:write' },
      schema: { params: idParamSchema, body: partApplicationInputSchema, response: { 201: partApplicationSchema } },
    },
    async (request, reply) => {
      reply.code(201);
      return service.addApplication(getAuth(request), request.params.id, request.body, clientInfo(request));
    },
  );

  app.delete(
    '/:id/applications/:applicationId',
    {
      config: { auth: 'catalog:write' },
      schema: { params: z.object({ id: z.uuid(), applicationId: z.uuid() }) },
    },
    async (request, reply) => {
      await service.removeApplication(getAuth(request), request.params.id, request.params.applicationId, clientInfo(request));
      return reply.code(204).send();
    },
  );
};

export const partCategoryRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = app.services.parts;

  app.get(
    '/',
    { config: { auth: 'catalog:read' }, schema: { response: { 200: z.object({ data: z.array(partCategorySchema) }) } } },
    async (request) => ({ data: await service.categories(getAuth(request)) }),
  );

  app.post(
    '/',
    { config: { auth: 'catalog:write' }, schema: { body: partCategoryInputSchema, response: { 201: partCategorySchema } } },
    async (request, reply) => {
      reply.code(201);
      return service.createCategory(getAuth(request), request.body.name, clientInfo(request));
    },
  );

  app.patch(
    '/:id',
    {
      config: { auth: 'catalog:write' },
      schema: { params: idParamSchema, body: partCategoryInputSchema, response: { 200: partCategorySchema } },
    },
    async (request) => service.renameCategory(getAuth(request), request.params.id, request.body.name, clientInfo(request)),
  );
};

export const inventoryRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = app.services.parts;

  app.post(
    '/movements',
    {
      config: { auth: 'inventory:adjust' },
      schema: { body: stockMovementInputSchema, response: { 201: movementResultSchema } },
    },
    async (request, reply) => {
      reply.code(201);
      return service.move(getAuth(request), request.body, clientInfo(request));
    },
  );

  app.get(
    '/summary',
    { config: { auth: 'inventory:read' }, schema: { response: { 200: inventorySummarySchema } } },
    async (request) => service.summary(getAuth(request)),
  );
};
