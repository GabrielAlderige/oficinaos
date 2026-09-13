import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { cancelPaymentSchema, idParamSchema, paymentListSchema, recordPaymentSchema } from '@oficinaos/shared';
import { clientInfo, getAuth } from '../../core/auth-context';

/**
 * Pagamento da OS (docs/API.md). Ler é de quem lê a OS; registrar tem permissão
 * própria (`payments:record`), que o atendente tem — ele é o caixa da oficina
 * pequena — sem que isso lhe dê acesso ao financeiro.
 */
export const workOrderPaymentRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = app.services.payments;

  app.get(
    '/:id/payments',
    {
      config: { auth: 'work_orders:read' },
      schema: { params: idParamSchema, response: { 200: paymentListSchema } },
    },
    async (request) => service.list(getAuth(request), request.params.id),
  );

  app.post(
    '/:id/payments',
    {
      config: { auth: 'payments:record' },
      schema: { params: idParamSchema, body: recordPaymentSchema, response: { 201: paymentListSchema } },
    },
    async (request, reply) => {
      reply.code(201);
      return service.record(getAuth(request), request.params.id, request.body, clientInfo(request));
    },
  );
};

/** Cancelar devolve a lista atualizada: a tela precisa do novo saldo na hora. */
export const paymentRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = app.services.payments;

  app.post(
    '/:id/cancel',
    {
      config: { auth: 'payments:cancel' },
      schema: { params: idParamSchema, body: cancelPaymentSchema, response: { 200: paymentListSchema } },
    },
    async (request) => service.cancel(getAuth(request), request.params.id, request.body, clientInfo(request)),
  );
};
