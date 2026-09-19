import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  addOfferToWorkOrderSchema,
  idParamSchema,
  partSearchQuerySchema,
  partSearchResultSchema,
  priceListImportResultSchema,
  priceListImportSchema,
  priceListSchema,
  workOrderSchema,
} from '@oficinaos/shared';
import { clientInfo, getAuth } from '../../core/auth-context';

/**
 * Pesquisa de peças (E14). Ver preço de peça é ver CUSTO: a permissão é
 * `parts:view_cost`, a mesma do histórico de preço — o atendente pede cotação,
 * mas não vê quanto a oficina paga (decisão da E11).
 */
export const partsSearchRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = app.services.partsSearch;

  app.post(
    '/',
    {
      config: { auth: 'parts:view_cost' },
      schema: { body: partSearchQuerySchema, response: { 200: partSearchResultSchema } },
    },
    async (request) => service.search(getAuth(request), request.body, clientInfo(request)),
  );

  app.get(
    '/:id',
    {
      config: { auth: 'parts:view_cost' },
      schema: { params: idParamSchema, response: { 200: partSearchResultSchema } },
    },
    async (request) => service.get(getAuth(request), request.params.id),
  );

  /** A oferta escolhida vira item da OS, pelo preço com a margem da oficina. */
  app.post(
    '/offers/:id/add-to-work-order',
    {
      config: { auth: 'work_orders:write' },
      schema: { params: idParamSchema, body: addOfferToWorkOrderSchema, response: { 201: workOrderSchema } },
    },
    async (request, reply) => {
      reply.code(201);
      return service.addToWorkOrder(getAuth(request), request.params.id, request.body, clientInfo(request));
    },
  );
};

/** A lista de preço vive no cadastro do fornecedor. */
export const supplierPriceListRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = app.services.partsSearch;

  app.get(
    '/:id/price-list',
    {
      config: { auth: 'parts:view_cost' },
      schema: {
        params: idParamSchema,
        querystring: z.object({
          q: z.string().trim().max(100).optional(),
          page: z.coerce.number().int().min(1).default(1),
          pageSize: z.coerce.number().int().min(1).max(100).default(25),
        }),
        response: { 200: priceListSchema },
      },
    },
    async (request) => service.priceList(getAuth(request), request.params.id, request.query),
  );

  /** Importar é mexer no cadastro do fornecedor: `suppliers:write`. */
  app.post(
    '/:id/price-list',
    {
      config: { auth: 'suppliers:write' },
      // a planilha vai no corpo como texto; o teto do corpo da API é 1 MB, e
      // esta rota aceita mais porque lista de fornecedor grande é normal
      bodyLimit: 8 * 1024 * 1024,
      schema: { params: idParamSchema, body: priceListImportSchema, response: { 201: priceListImportResultSchema } },
    },
    async (request, reply) => {
      reply.code(201);
      return service.importPriceList(getAuth(request), request.params.id, request.body, clientInfo(request));
    },
  );
};
