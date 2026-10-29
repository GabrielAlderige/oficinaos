import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { idParamSchema, posChargeSchema, posSettingsSchema, startPosChargeSchema, updatePosSettingsSchema } from '@oficinaos/shared';
import { clientInfo, getAuth } from '../../core/auth-context';

/**
 * Maquininha Stone (E50). Configurar é de quem mexe na oficina; cobrar é de
 * quem registra pagamento (os mesmos que vendem no balcão).
 */
export const posRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = app.services.pos;

  app.get(
    '/settings',
    { config: { auth: 'payments:record' }, schema: { response: { 200: posSettingsSchema } } },
    async (request) => service.settings(getAuth(request)),
  );

  app.put(
    '/settings',
    { config: { auth: 'organization:manage' }, schema: { body: updatePosSettingsSchema, response: { 200: posSettingsSchema } } },
    async (request) => service.updateSettings(getAuth(request), request.body, clientInfo(request)),
  );

  app.get(
    '/charges',
    {
      config: { auth: 'payments:record' },
      schema: {
        querystring: z
          .object({ workOrderId: z.uuid().optional(), counterSaleId: z.uuid().optional() })
          .refine((q) => !!q.workOrderId !== !!q.counterSaleId, { message: 'Informe a OS ou a venda' }),
        response: { 200: z.object({ data: z.array(posChargeSchema) }) },
      },
    },
    async (request) => ({ data: await service.listFor(getAuth(request), request.query) }),
  );

  app.post(
    '/charges',
    {
      config: { auth: 'payments:record', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: { body: startPosChargeSchema, response: { 201: posChargeSchema } },
    },
    async (request, reply) => reply.code(201).send(await service.start(getAuth(request), request.body, clientInfo(request))),
  );

  // a tela pergunta a cada 2 s enquanto espera o cartão
  app.get(
    '/charges/:id',
    {
      config: { auth: 'payments:record', rateLimit: { max: 120, timeWindow: '1 minute' } },
      schema: { params: idParamSchema, response: { 200: posChargeSchema } },
    },
    async (request) => service.get(getAuth(request), request.params.id),
  );

  app.post(
    '/charges/:id/cancel',
    { config: { auth: 'payments:record' }, schema: { params: idParamSchema, response: { 200: posChargeSchema } } },
    async (request) => service.cancel(getAuth(request), request.params.id, clientInfo(request)),
  );

  app.post(
    '/charges/:id/simulate-paid',
    { config: { auth: 'payments:record' }, schema: { params: idParamSchema, response: { 200: posChargeSchema } } },
    async (request) => service.simulatePaid(getAuth(request), request.params.id),
  );
};

/**
 * O aviso da Stone (sem login). Ele só aponta o pedido: o serviço pergunta à
 * Stone, com a chave da oficina, o que de fato aconteceu — aviso forjado não
 * lança dinheiro. Responde 200 sempre que entendeu o corpo, para a Stone não
 * ficar reenviando.
 */
export const stoneWebhookRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/stone',
    {
      config: { auth: 'public', rateLimit: { max: 600, timeWindow: '1 minute' } },
      schema: {
        body: z.object({
          type: z.string().max(80),
          data: z.object({ order: z.object({ id: z.string().max(80) }).loose().optional() }).loose(),
        }).loose(),
        response: { 200: z.object({ handled: z.boolean(), reason: z.string() }) },
      },
    },
    async (request) => {
      const { type, data } = request.body;
      if (!type.startsWith('charge.') || !data.order?.id) return { handled: false, reason: 'evento ignorado' };
      try {
        const resultado = await app.services.pos.handleWebhook(data.order.id);
        request.log.info({ type, ...resultado }, 'aviso da maquininha');
        return resultado;
      } catch (erro) {
        // a Stone fora do ar na consulta: devolve erro para ela reenviar depois
        request.log.error({ err: erro, type }, 'aviso da maquininha falhou');
        throw erro;
      }
    },
  );
};
