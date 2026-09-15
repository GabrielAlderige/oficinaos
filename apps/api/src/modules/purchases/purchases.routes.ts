import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  cancelPurchaseOrderSchema,
  closePurchaseOrderSchema,
  createPurchaseOrderSchema,
  idParamSchema,
  orderedPurchaseOrderSchema,
  partPriceHistorySchema,
  orderPurchaseOrderSchema,
  paginated,
  purchaseOrderListItemSchema,
  purchaseOrderListQuerySchema,
  purchaseOrderSchema,
  purchaseOrdersFromQuoteResultSchema,
  purchaseOrdersFromQuoteSchema,
  purchaseSuggestionsSchema,
  receivePurchaseOrderSchema,
  returnPurchaseOrderSchema,
  supplierHistorySchema,
  updatePurchaseOrderSchema,
  workOrderPurchaseLineSchema,
} from '@oficinaos/shared';
import { clientInfo, getAuth } from '../../core/auth-context';

/**
 * Compras (MVP 2, E12). Ler é `purchases:read` (inclui o financeiro, que paga);
 * tudo o que muda pedido é `purchases:write` — do gerente para cima, porque
 * mexe em custo (decisão de 14/09/2026).
 */
export const purchaseOrderRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = app.services.purchases;

  app.get(
    '/',
    {
      config: { auth: 'purchases:read' },
      schema: { querystring: purchaseOrderListQuerySchema, response: { 200: paginated(purchaseOrderListItemSchema) } },
    },
    async (request) => service.list(getAuth(request), request.query),
  );

  app.post(
    '/',
    {
      config: { auth: 'purchases:write' },
      schema: { body: createPurchaseOrderSchema, response: { 201: purchaseOrderSchema } },
    },
    async (request, reply) => {
      reply.code(201);
      return service.create(getAuth(request), request.body, clientInfo(request));
    },
  );

  /** O que comprar: estoque abaixo do mínimo e peças que as OS esperam. */
  app.get(
    '/suggestions',
    {
      config: { auth: 'purchases:read' },
      schema: { response: { 200: purchaseSuggestionsSchema } },
    },
    async (request) => service.suggestions(getAuth(request)),
  );

  app.post(
    '/from-quote',
    {
      config: { auth: 'purchases:write' },
      schema: { body: purchaseOrdersFromQuoteSchema, response: { 201: purchaseOrdersFromQuoteResultSchema } },
    },
    async (request, reply) => {
      reply.code(201);
      return service.fromQuote(getAuth(request), request.body.supplierQuoteRequestId, clientInfo(request));
    },
  );

  app.get(
    '/:id',
    {
      config: { auth: 'purchases:read' },
      schema: { params: idParamSchema, response: { 200: purchaseOrderSchema } },
    },
    async (request) => service.get(getAuth(request), request.params.id),
  );

  app.patch(
    '/:id',
    {
      config: { auth: 'purchases:write' },
      schema: { params: idParamSchema, body: updatePurchaseOrderSchema, response: { 200: purchaseOrderSchema } },
    },
    async (request) => service.update(getAuth(request), request.params.id, request.body, clientInfo(request)),
  );

  app.post(
    '/:id/order',
    {
      config: { auth: 'purchases:write' },
      schema: { params: idParamSchema, body: orderPurchaseOrderSchema, response: { 200: orderedPurchaseOrderSchema } },
    },
    async (request) => service.order(getAuth(request), request.params.id, request.body, clientInfo(request)),
  );

  app.post(
    '/:id/cancel',
    {
      config: { auth: 'purchases:write' },
      schema: { params: idParamSchema, body: cancelPurchaseOrderSchema, response: { 200: purchaseOrderSchema } },
    },
    async (request) => service.cancel(getAuth(request), request.params.id, request.body, clientInfo(request)),
  );

  /** A mercadoria chegou: estoque, custo médio com frete e reserva para a OS. */
  app.post(
    '/:id/receipts',
    {
      config: { auth: 'purchases:write' },
      schema: { params: idParamSchema, body: receivePurchaseOrderSchema, response: { 201: purchaseOrderSchema } },
    },
    async (request, reply) => {
      reply.code(201);
      return service.receive(getAuth(request), request.params.id, request.body, clientInfo(request));
    },
  );

  /** Devolução ao fornecedor: a correção de um recebimento. */
  app.post(
    '/:id/returns',
    {
      config: { auth: 'purchases:write' },
      schema: { params: idParamSchema, body: returnPurchaseOrderSchema, response: { 201: purchaseOrderSchema } },
    },
    async (request, reply) => {
      reply.code(201);
      return service.returnItems(getAuth(request), request.params.id, request.body, clientInfo(request));
    },
  );

  app.post(
    '/:id/close',
    {
      config: { auth: 'purchases:write' },
      schema: { params: idParamSchema, body: closePurchaseOrderSchema, response: { 200: purchaseOrderSchema } },
    },
    async (request) => service.close(getAuth(request), request.params.id, request.body, clientInfo(request)),
  );
};

/** O que foi comprado para uma OS, na ficha dela. */
export const workOrderPurchaseRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = app.services.purchases;

  app.get(
    '/:id/purchases',
    {
      config: { auth: 'purchases:read' },
      schema: { params: idParamSchema, response: { 200: z.object({ data: z.array(workOrderPurchaseLineSchema) }) } },
    },
    async (request) => service.listForWorkOrder(getAuth(request), request.params.id),
  );
};

/** O que a oficina já fez com o fornecedor (a ficha dele). */
export const supplierHistoryRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = app.services.purchases;

  app.get(
    '/:id/history',
    {
      config: { auth: 'suppliers:read' },
      schema: { params: idParamSchema, response: { 200: supplierHistorySchema } },
    },
    async (request) => service.supplierHistory(getAuth(request), request.params.id),
  );
};

/** Histórico de preço da peça: é custo, então é de quem vê custo. */
export const partPriceHistoryRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = app.services.purchases;

  app.get(
    '/:id/price-history',
    {
      config: { auth: 'parts:view_cost' },
      schema: { params: idParamSchema, response: { 200: partPriceHistorySchema } },
    },
    async (request) => service.partPriceHistory(getAuth(request), request.params.id),
  );
};
