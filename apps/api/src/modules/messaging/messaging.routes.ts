import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  connectChannelSchema,
  conversationHelpersSchema,
  conversationSchema,
  conversationSummarySchema,
  messagingOverviewSchema,
  sendMessageResultSchema,
  sendMessageSchema,
  updateAutoSendSchema,
  updateTemplateSchema,
} from '@oficinaos/shared';
import { clientInfo, getAuth } from '../../core/auth-context';

const customerParam = z.object({ customerId: z.uuid() });

/**
 * O canal de WhatsApp da oficina (E22). Conectar mexe na credencial da
 * empresa e fica com quem cuida da oficina (`organization:manage`); conversar
 * é trabalho de balcão (`messages:send`).
 */
export const messagingRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = app.services.messaging;

  app.get(
    '/channel',
    {
      config: { auth: 'organization:manage' },
      schema: { response: { 200: messagingOverviewSchema } },
    },
    async (request) => service.overview(getAuth(request)),
  );

  app.post(
    '/channel',
    {
      config: { auth: 'organization:manage' },
      schema: { body: connectChannelSchema, response: { 200: messagingOverviewSchema } },
    },
    async (request) => service.connect(getAuth(request), request.body, clientInfo(request)),
  );

  app.delete(
    '/channel',
    {
      config: { auth: 'organization:manage' },
      schema: { response: { 200: messagingOverviewSchema } },
    },
    async (request) => service.disconnect(getAuth(request), clientInfo(request)),
  );

  app.patch(
    '/templates',
    {
      config: { auth: 'organization:manage' },
      schema: { body: updateTemplateSchema, response: { 200: messagingOverviewSchema } },
    },
    async (request) => service.saveTemplate(getAuth(request), request.body),
  );

  app.put(
    '/auto-send',
    {
      config: { auth: 'organization:manage' },
      schema: { body: updateAutoSendSchema, response: { 200: messagingOverviewSchema } },
    },
    async (request) => service.setAutoSend(getAuth(request), request.body, clientInfo(request)),
  );

  app.get(
    '/conversations',
    {
      config: { auth: 'messages:send' },
      schema: { response: { 200: z.array(conversationSummarySchema) } },
    },
    async (request) => service.conversations(getAuth(request)),
  );

  app.get(
    '/conversations/:customerId',
    {
      config: { auth: 'messages:send' },
      schema: { params: customerParam, response: { 200: conversationSchema } },
    },
    async (request) => service.conversation(getAuth(request), request.params.customerId),
  );

  app.post(
    '/conversations/:customerId/read',
    {
      config: { auth: 'messages:send' },
      schema: { params: customerParam, response: { 200: conversationSchema } },
    },
    async (request) => service.markRead(getAuth(request), request.params.customerId),
  );

  app.get(
    '/conversations/:customerId/templates',
    {
      config: { auth: 'messages:send' },
      schema: { params: customerParam, response: { 200: conversationHelpersSchema } },
    },
    async (request) => service.previews(getAuth(request), request.params.customerId),
  );

  app.post(
    '/conversations/:customerId/messages',
    {
      config: { auth: 'messages:send' },
      schema: { params: customerParam, body: sendMessageSchema, response: { 201: sendMessageResultSchema } },
    },
    async (request, reply) => {
      const resultado = await service.send(
        getAuth(request),
        request.params.customerId,
        request.body,
        clientInfo(request),
      );
      return reply.code(201).send(resultado);
    },
  );
};

/**
 * O aviso da Meta. Sem login: quem prova a origem é a assinatura do corpo CRU
 * com o segredo do app da oficina — e é por isso que este plugin registra o
 * próprio parser de JSON, que **não** desmonta o corpo. Corpo reserializado dá
 * outra assinatura por um espaço de diferença, e aí nada entraria nunca.
 *
 * A oficina está no caminho porque a Meta usa um endereço só para os dois
 * verbos: o GET da verificação chega sem nada que a identifique.
 *
 * Responde 200 mesmo quando o aviso não interessa: a Meta reenvia o que dá
 * erro, para sempre, e fila entupida atrasa a mensagem de todo mundo.
 */
export const whatsappWebhookRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = app.services.messaging;

  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
    done(null, body);
  });

  app.get(
    '/whatsapp/:organizationId',
    {
      config: { auth: 'public', rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        params: z.object({ organizationId: z.uuid() }),
        querystring: z.object({
          'hub.mode': z.string().optional(),
          'hub.verify_token': z.string().optional(),
          'hub.challenge': z.string().optional(),
        }),
      },
    },
    async (request, reply) => {
      const desafio = service.verificarEndereco(request.params.organizationId, {
        mode: request.query['hub.mode'],
        token: request.query['hub.verify_token'],
        challenge: request.query['hub.challenge'],
      });
      // a Meta espera o desafio cru, sem JSON em volta
      return reply.type('text/plain').send(desafio);
    },
  );

  app.post(
    '/whatsapp/:organizationId',
    {
      config: { auth: 'public', rateLimit: { max: 600, timeWindow: '1 minute' } },
      schema: {
        params: z.object({ organizationId: z.uuid() }),
        response: {
          200: z.object({ handled: z.boolean(), reason: z.string() }),
          401: z.object({ handled: z.boolean(), reason: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const bruto = typeof request.body === 'string' ? request.body : JSON.stringify(request.body ?? {});
      const assinatura = request.headers['x-hub-signature-256'];
      try {
        const resultado = await service.handleWebhook(
          request.params.organizationId,
          bruto,
          typeof assinatura === 'string' ? assinatura : undefined,
        );
        request.log.info({ organizationId: request.params.organizationId, ...resultado }, 'aviso do whatsapp');
        return resultado;
      } catch (erro) {
        // assinatura errada é a única coisa que vira erro; o resto responde 200
        request.log.warn({ err: erro, organizationId: request.params.organizationId }, 'aviso do whatsapp recusado');
        return reply.code(401).send({ handled: false, reason: 'aviso recusado' });
      }
    },
  );
};
