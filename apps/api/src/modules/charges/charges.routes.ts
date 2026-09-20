import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { cancelChargeSchema, chargeSummarySchema, createChargeSchema, idParamSchema } from '@oficinaos/shared';
import { clientInfo, getAuth } from '../../core/auth-context';

/**
 * Cobrança online (E19). Mandar o Pix é trabalho de balcão (`charges:create`),
 * mas **estornar é devolver dinheiro** e fica com quem já cancela pagamento.
 */
export const workOrderChargeRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = app.services.charges;

  app.get(
    '/:id/charges',
    {
      config: { auth: 'payments:record' },
      schema: { params: idParamSchema, response: { 200: chargeSummarySchema } },
    },
    async (request) => service.summary(getAuth(request), request.params.id),
  );

  app.post(
    '/:id/charges',
    {
      config: { auth: 'charges:create' },
      schema: { params: idParamSchema, body: createChargeSchema, response: { 201: chargeSummarySchema } },
    },
    async (request, reply) => {
      const resumo = await service.create(getAuth(request), request.params.id, request.body, clientInfo(request));
      return reply.code(201).send(resumo);
    },
  );
};

export const chargeRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = app.services.charges;

  app.post(
    '/:id/cancel',
    {
      config: { auth: 'charges:create' },
      schema: { params: idParamSchema, body: cancelChargeSchema, response: { 200: chargeSummarySchema } },
    },
    async (request) => service.cancel(getAuth(request), request.params.id, request.body, clientInfo(request)),
  );

  app.post(
    '/:id/refund',
    {
      config: { auth: 'charges:refund' },
      schema: { params: idParamSchema, response: { 200: chargeSummarySchema } },
    },
    async (request) => service.refund(getAuth(request), request.params.id, clientInfo(request)),
  );
};

/**
 * O aviso do gateway. Sem login: quem prova a origem é o token que o gateway
 * repete em todo aviso (o driver recusa sem ele). O corpo cru é necessário —
 * alguns gateways assinam o texto exato, não o JSON reserializado.
 *
 * Responde 200 mesmo quando o aviso não interessa: gateway que recebe erro
 * reenvia para sempre, e fila de reenvio entupida atrasa o dinheiro de todo
 * mundo. O que aconteceu fica em `handled`/`reason` e no log.
 */
export const paymentWebhookRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = app.services.charges;

  app.post(
    '/payments/:provider',
    {
      config: { auth: 'public', rateLimit: { max: 600, timeWindow: '1 minute' } },
      schema: {
        params: z.object({ provider: z.string().max(40) }),
        response: {
          200: z.object({ handled: z.boolean(), reason: z.string() }),
          401: z.object({ handled: z.boolean(), reason: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const bruto = typeof request.body === 'string' ? request.body : JSON.stringify(request.body ?? {});
      try {
        const resultado = await service.handleWebhook(request.headers, bruto);
        request.log.info({ provider: request.params.provider, ...resultado }, 'aviso de pagamento');
        return resultado;
      } catch (erro) {
        // token errado é a única coisa que vira erro: o resto responde 200
        request.log.warn({ err: erro, provider: request.params.provider }, 'aviso de pagamento recusado');
        return reply.code(401).send({ handled: false, reason: 'aviso recusado' });
      }
    },
  );
};
