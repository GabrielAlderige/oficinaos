import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  convertLeadSchema,
  followUpDoneSchema,
  followUpListQuerySchema,
  followUpListSchema,
  idParamSchema,
  leadFormSchema,
  leadSchema,
  moveLeadSchema,
  pipelineSchema,
  publicTrackingSchema,
  reviewInviteResultSchema,
  updateLeadSchema,
} from '@oficinaos/shared';
import { clientInfo, getAuth } from '../../core/auth-context';

const ok = z.object({ ok: z.literal(true) });

/**
 * Pós-venda, avaliações e CRM (E16). Tudo aqui é trabalho de **atendimento**,
 * então a permissão é a de cliente: quem liga para o cliente é a mesma pessoa
 * que cadastra o cliente.
 *
 * Ler a fila e o funil exige `customers:view_contact`, não `customers:read`:
 * as duas telas existem para MOSTRAR telefone com link de WhatsApp, e o
 * mecânico — que vê o cliente da OS, mas não o contato dele — fica de fora.
 */
export const followUpRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = app.services.followUps;

  app.get(
    '/',
    {
      config: { auth: 'customers:view_contact' },
      schema: { querystring: followUpListQuerySchema, response: { 200: followUpListSchema } },
    },
    async (request) => service.list(getAuth(request), request.query),
  );

  app.post(
    '/:id/done',
    {
      config: { auth: 'customers:write' },
      schema: { params: idParamSchema, body: followUpDoneSchema, response: { 200: ok } },
    },
    async (request) => service.done(getAuth(request), request.params.id, request.body.outcome, clientInfo(request)),
  );

  app.post(
    '/:id/skip',
    {
      config: { auth: 'customers:write' },
      schema: { params: idParamSchema, body: followUpDoneSchema, response: { 200: ok } },
    },
    async (request) => service.skip(getAuth(request), request.params.id, request.body.outcome, clientInfo(request)),
  );
};

/**
 * O convite para avaliar sai da ficha da OS, depois da entrega — e leva ao
 * **Google** da oficina. Não há mais página de avaliação aqui dentro: nota
 * guardada no nosso banco não aparece para quem procura oficina na internet.
 */
export const workOrderReviewRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/:id/review-invite',
    {
      config: { auth: 'quotes:send' },
      schema: { params: idParamSchema, response: { 201: reviewInviteResultSchema } },
    },
    async (request, reply) => {
      reply.code(201);
      return app.services.reviews.invite(getAuth(request), request.params.id, clientInfo(request));
    },
  );
};

/** "Acompanhe seu veículo" (E17): a página do cliente, sem login. */
export const publicTrackingRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/tracking/:token',
    {
      config: { auth: 'public', rateLimit: { max: 120, timeWindow: '1 minute' } },
      schema: {
        params: z.object({ token: z.string().min(16).max(200) }),
        response: { 200: publicTrackingSchema },
      },
    },
    async (request) => app.services.tracking.publicGet(request.params.token),
  );
};

export const leadRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = app.services.leads;

  app.get(
    '/',
    {
      config: { auth: 'customers:view_contact' },
      schema: { querystring: z.object({ q: z.string().trim().max(100).optional() }), response: { 200: pipelineSchema } },
    },
    async (request) => service.pipeline(getAuth(request), request.query.q),
  );

  app.post(
    '/',
    { config: { auth: 'customers:write' }, schema: { body: leadFormSchema, response: { 201: leadSchema } } },
    async (request, reply) => {
      reply.code(201);
      return service.create(getAuth(request), request.body, clientInfo(request));
    },
  );

  app.patch(
    '/:id',
    {
      config: { auth: 'customers:write' },
      schema: { params: idParamSchema, body: updateLeadSchema, response: { 200: leadSchema } },
    },
    async (request) => service.update(getAuth(request), request.params.id, request.body, clientInfo(request)),
  );

  app.post(
    '/:id/stage',
    {
      config: { auth: 'customers:write' },
      schema: { params: idParamSchema, body: moveLeadSchema, response: { 200: leadSchema } },
    },
    async (request) => service.move(getAuth(request), request.params.id, request.body, clientInfo(request)),
  );

  app.post(
    '/:id/convert',
    {
      config: { auth: 'customers:write' },
      schema: { params: idParamSchema, body: convertLeadSchema, response: { 200: leadSchema } },
    },
    async (request) => service.convert(getAuth(request), request.params.id, request.body.customerId, clientInfo(request)),
  );
};
