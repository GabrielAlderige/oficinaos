import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  customerFormSchema,
  customerListItemSchema,
  customerSchema,
  idParamSchema,
  listQuerySchema,
  paginated,
  updateCustomerSchema,
  vehicleListItemSchema,
} from '@oficinaos/shared';
import { clientInfo, getAuth } from '../../core/auth-context';

export const customerRoutes: FastifyPluginAsyncZod = async (app) => {
  const customers = app.services.customers;
  const vehicles = app.services.vehicles;

  app.get(
    '/',
    {
      config: { auth: 'customers:read' },
      schema: { querystring: listQuerySchema, response: { 200: paginated(customerListItemSchema) } },
    },
    async (request) => customers.list(getAuth(request), request.query),
  );

  app.post(
    '/',
    { config: { auth: 'customers:write' }, schema: { body: customerFormSchema, response: { 201: customerSchema } } },
    async (request, reply) => {
      reply.code(201);
      return customers.create(getAuth(request), request.body, clientInfo(request));
    },
  );

  app.get(
    '/:id',
    { config: { auth: 'customers:read' }, schema: { params: idParamSchema, response: { 200: customerSchema } } },
    async (request) => customers.get(getAuth(request), request.params.id),
  );

  app.patch(
    '/:id',
    {
      config: { auth: 'customers:write' },
      schema: { params: idParamSchema, body: updateCustomerSchema, response: { 200: customerSchema } },
    },
    async (request) => customers.update(getAuth(request), request.params.id, request.body, clientInfo(request)),
  );

  app.delete(
    '/:id',
    { config: { auth: 'customers:delete' }, schema: { params: idParamSchema } },
    async (request, reply) => {
      await customers.remove(getAuth(request), request.params.id, clientInfo(request));
      return reply.code(204).send();
    },
  );

  app.get(
    '/:id/vehicles',
    {
      config: { auth: 'customers:read' },
      schema: { params: idParamSchema, response: { 200: z.object({ data: z.array(vehicleListItemSchema) }) } },
    },
    async (request) => ({ data: await vehicles.listByCustomer(getAuth(request), request.params.id) }),
  );
};
