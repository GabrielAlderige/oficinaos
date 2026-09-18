import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  cancelFinancialEntrySchema,
  cancelSettlementSchema,
  cashFlowSchema,
  createFinancialEntrySchema,
  financialCategoryFormSchema,
  financialCategoryListSchema,
  financialCategorySchema,
  financialEntryDetailSchema,
  financialEntrySchema,
  financialListQuerySchema,
  financialListSchema,
  financialPeriodQuerySchema,
  idParamSchema,
  profitSchema,
  settleFinancialEntrySchema,
  splitFinancialEntrySchema,
  updateFinancialEntrySchema,
  FINANCIAL_DIRECTIONS,
} from '@oficinaos/shared';
import { clientInfo, getAuth } from '../../core/auth-context';

const entryListSchema = z.object({ data: z.array(financialEntrySchema) });

/**
 * Financeiro (E13). Ler é `finance:read` (dono, gerente e o financeiro);
 * mexer em dinheiro — criar, editar, parcelar, baixar e cancelar — é
 * `finance:write`, que o atendente não tem: ele registra o pagamento da OS no
 * caixa, e isso já chega aqui pela conta a receber.
 */
export const financeRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = app.services.finance;

  app.get(
    '/entries',
    {
      config: { auth: 'finance:read' },
      schema: { querystring: financialListQuerySchema, response: { 200: financialListSchema } },
    },
    async (request) => service.list(getAuth(request), request.query),
  );

  app.post(
    '/entries',
    {
      config: { auth: 'finance:write' },
      schema: { body: createFinancialEntrySchema, response: { 201: entryListSchema } },
    },
    async (request, reply) => {
      reply.code(201);
      return service.create(getAuth(request), request.body, clientInfo(request));
    },
  );

  app.get(
    '/entries/:id',
    {
      config: { auth: 'finance:read' },
      schema: { params: idParamSchema, response: { 200: financialEntryDetailSchema } },
    },
    async (request) => service.get(getAuth(request), request.params.id),
  );

  app.patch(
    '/entries/:id',
    {
      config: { auth: 'finance:write' },
      schema: {
        params: idParamSchema,
        body: updateFinancialEntrySchema,
        response: { 200: financialEntryDetailSchema },
      },
    },
    async (request) => service.update(getAuth(request), request.params.id, request.body, clientInfo(request)),
  );

  app.post(
    '/entries/:id/cancel',
    {
      config: { auth: 'finance:write' },
      schema: {
        params: idParamSchema,
        body: cancelFinancialEntrySchema,
        response: { 200: financialEntryDetailSchema },
      },
    },
    async (request) => service.cancel(getAuth(request), request.params.id, request.body.reason, clientInfo(request)),
  );

  /** Parcelar: o "fiado" da oficina vira carnê, sem perder centavo. */
  app.post(
    '/entries/:id/installments',
    {
      config: { auth: 'finance:write' },
      schema: { params: idParamSchema, body: splitFinancialEntrySchema, response: { 201: entryListSchema } },
    },
    async (request, reply) => {
      reply.code(201);
      return service.split(getAuth(request), request.params.id, request.body, clientInfo(request));
    },
  );

  /** A baixa. Em conta de OS, ela é o próprio pagamento do caixa (E7). */
  app.post(
    '/entries/:id/settlements',
    {
      config: { auth: 'finance:write' },
      schema: {
        params: idParamSchema,
        body: settleFinancialEntrySchema,
        response: { 201: financialEntryDetailSchema },
      },
    },
    async (request, reply) => {
      reply.code(201);
      return service.settle(getAuth(request), request.params.id, request.body, clientInfo(request));
    },
  );

  app.post(
    '/settlements/:id/cancel',
    {
      config: { auth: 'finance:write' },
      schema: { params: idParamSchema, body: cancelSettlementSchema, response: { 200: financialEntryDetailSchema } },
    },
    async (request) =>
      service.cancelSettlement(getAuth(request), request.params.id, request.body.reason, clientInfo(request)),
  );

  app.get(
    '/cash-flow',
    {
      config: { auth: 'finance:read' },
      schema: { querystring: financialPeriodQuerySchema, response: { 200: cashFlowSchema } },
    },
    async (request) => service.cashFlow(getAuth(request), request.query),
  );

  app.get(
    '/profit',
    {
      config: { auth: 'finance:read' },
      schema: { querystring: financialPeriodQuerySchema, response: { 200: profitSchema } },
    },
    async (request) => service.profit(getAuth(request), request.query),
  );

  app.get(
    '/categories',
    {
      config: { auth: 'finance:read' },
      schema: {
        querystring: z.object({ direction: z.enum(FINANCIAL_DIRECTIONS).optional() }),
        response: { 200: financialCategoryListSchema },
      },
    },
    async (request) => service.listCategories(getAuth(request), request.query.direction),
  );

  app.post(
    '/categories',
    {
      config: { auth: 'finance:write' },
      schema: { body: financialCategoryFormSchema, response: { 201: financialCategorySchema } },
    },
    async (request, reply) => {
      reply.code(201);
      return service.createCategory(getAuth(request), request.body, clientInfo(request));
    },
  );

  app.patch(
    '/categories/:id',
    {
      config: { auth: 'finance:write' },
      schema: {
        params: idParamSchema,
        body: financialCategoryFormSchema.pick({ name: true }),
        response: { 200: financialCategorySchema },
      },
    },
    async (request) => service.renameCategory(getAuth(request), request.params.id, request.body.name, clientInfo(request)),
  );

  app.delete(
    '/categories/:id',
    {
      config: { auth: 'finance:write' },
      schema: { params: idParamSchema, response: { 204: z.null() } },
    },
    async (request, reply) => {
      await service.deleteCategory(getAuth(request), request.params.id, clientInfo(request));
      return reply.code(204).send(null);
    },
  );
};
