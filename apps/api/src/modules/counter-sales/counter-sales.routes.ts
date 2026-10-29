import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  cancelCounterSaleSchema,
  counterSaleListQuerySchema,
  counterSaleSchema,
  createCounterSaleSchema,
  idParamSchema,
  pageMetaSchema,
} from '@oficinaos/shared';
import { clientInfo, getAuth } from '../../core/auth-context';

/**
 * Venda de balcão (E49). Vale em todos os planos: vender uma peça sem OS é
 * o básico de qualquer oficina que tem prateleira.
 */
export const counterSaleRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = app.services.counterSales;

  app.get(
    '/',
    {
      config: { auth: 'counter_sales:sell' },
      schema: {
        querystring: counterSaleListQuerySchema,
        response: { 200: z.object({ data: z.array(counterSaleSchema), meta: pageMetaSchema }) },
      },
    },
    async (request) => service.list(getAuth(request), request.query.page, request.query.pageSize),
  );

  app.get(
    '/:id',
    { config: { auth: 'counter_sales:sell' }, schema: { params: idParamSchema, response: { 200: counterSaleSchema } } },
    async (request) => service.get(getAuth(request), request.params.id),
  );

  app.post(
    '/',
    {
      config: { auth: 'counter_sales:sell' },
      schema: { body: createCounterSaleSchema, response: { 201: counterSaleSchema } },
    },
    async (request, reply) => {
      const venda = await service.create(getAuth(request), request.body, clientInfo(request));
      return reply.code(201).send(venda);
    },
  );

  app.post(
    '/:id/cancel',
    {
      config: { auth: 'counter_sales:cancel' },
      schema: { params: idParamSchema, body: cancelCounterSaleSchema, response: { 200: counterSaleSchema } },
    },
    async (request) => service.cancel(getAuth(request), request.params.id, request.body.reason, clientInfo(request)),
  );
};
