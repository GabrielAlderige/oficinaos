import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  createUnitSchema,
  networkOverviewSchema,
  networkQuerySchema,
  stockTransferResultSchema,
  stockTransferSchema,
} from '@oficinaos/shared';
import { clientInfo, getAuth } from '../../core/auth-context';

/**
 * Várias unidades (E50), no Nitro. Tudo aqui é de quem administra a oficina:
 * abrir unidade, ver o resultado de todas e mover estoque entre elas.
 */
export const networkRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = app.services.network;

  app.get(
    '/',
    {
      config: { auth: 'organization:manage', feature: 'multi_branch' },
      schema: { querystring: networkQuerySchema, response: { 200: networkOverviewSchema } },
    },
    async (request) => service.overview(getAuth(request), request.query),
  );

  app.post(
    '/units',
    {
      config: { auth: 'organization:manage', feature: 'multi_branch', rateLimit: { max: 5, timeWindow: '1 hour' } },
      schema: { body: createUnitSchema, response: { 201: z.object({ id: z.uuid(), name: z.string() }) } },
    },
    async (request, reply) => reply.code(201).send(await service.createUnit(getAuth(request), request.body, clientInfo(request))),
  );

  app.post(
    '/transfers',
    {
      config: { auth: 'organization:manage', feature: 'multi_branch' },
      schema: { body: stockTransferSchema, response: { 201: stockTransferResultSchema } },
    },
    async (request, reply) => reply.code(201).send(await service.transfer(getAuth(request), request.body, clientInfo(request))),
  );
};
