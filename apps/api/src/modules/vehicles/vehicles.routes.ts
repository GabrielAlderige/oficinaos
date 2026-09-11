import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  createVehicleSchema,
  idParamSchema,
  odometerReadingSchema,
  paginated,
  plateLookupQuerySchema,
  transferVehicleSchema,
  updateVehicleSchema,
  vehicleListItemSchema,
  vehicleListQuerySchema,
  vehicleSchema,
} from '@oficinaos/shared';
import { clientInfo, getAuth } from '../../core/auth-context';

export const vehicleRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = app.services.vehicles;

  app.get(
    '/',
    {
      config: { auth: 'customers:read' },
      schema: { querystring: vehicleListQuerySchema, response: { 200: paginated(vehicleListItemSchema) } },
    },
    async (request) => service.list(getAuth(request), request.query),
  );

  // estática antes de "/:id": busca instantânea por placa (balcão e, na E5, a Nova OS)
  app.get(
    '/lookup',
    {
      config: { auth: 'customers:read' },
      schema: { querystring: plateLookupQuerySchema, response: { 200: z.object({ data: z.array(vehicleListItemSchema) }) } },
    },
    async (request) => ({ data: await service.lookup(getAuth(request), request.query.plate) }),
  );

  app.post(
    '/',
    { config: { auth: 'vehicles:write' }, schema: { body: createVehicleSchema, response: { 201: vehicleSchema } } },
    async (request, reply) => {
      reply.code(201);
      return service.create(getAuth(request), request.body, clientInfo(request));
    },
  );

  app.get(
    '/:id',
    { config: { auth: 'customers:read' }, schema: { params: idParamSchema, response: { 200: vehicleSchema } } },
    async (request) => service.get(getAuth(request), request.params.id),
  );

  app.patch(
    '/:id',
    {
      config: { auth: 'vehicles:write' },
      schema: { params: idParamSchema, body: updateVehicleSchema, response: { 200: vehicleSchema } },
    },
    async (request) => service.update(getAuth(request), request.params.id, request.body, clientInfo(request)),
  );

  app.post(
    '/:id/transfer',
    {
      config: { auth: 'vehicles:write' },
      schema: { params: idParamSchema, body: transferVehicleSchema, response: { 200: vehicleSchema } },
    },
    async (request) =>
      service.transfer(getAuth(request), request.params.id, request.body.customerId, clientInfo(request)),
  );

  app.delete(
    '/:id',
    { config: { auth: 'vehicles:delete' }, schema: { params: idParamSchema } },
    async (request, reply) => {
      await service.remove(getAuth(request), request.params.id, clientInfo(request));
      return reply.code(204).send();
    },
  );

  app.get(
    '/:id/odometer-readings',
    {
      config: { auth: 'customers:read' },
      schema: { params: idParamSchema, response: { 200: z.object({ data: z.array(odometerReadingSchema) }) } },
    },
    async (request) => ({ data: await service.readings(getAuth(request), request.params.id) }),
  );
};
