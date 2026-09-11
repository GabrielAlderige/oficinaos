import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { searchQuerySchema, searchResultSchema } from '@oficinaos/shared';
import { getAuth } from '../../core/auth-context';

const LIMIT = 5;

/** Busca global (⌘K): placa, nome, telefone ou documento. OS e orçamentos entram na E5/E6. */
export const searchRoutes: FastifyPluginAsyncZod = async (app) => {
  const { customers, vehicles } = app.services;

  app.get(
    '/',
    {
      config: { auth: 'customers:read' },
      schema: { querystring: searchQuerySchema, response: { 200: searchResultSchema } },
    },
    async (request) => {
      const auth = getAuth(request);
      const [foundCustomers, foundVehicles] = await Promise.all([
        customers.search(auth, request.query.q, LIMIT),
        vehicles.search(auth, request.query.q, LIMIT),
      ]);
      return { customers: foundCustomers, vehicles: foundVehicles };
    },
  );
};
