import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  createQuoteSchema,
  idParamSchema,
  manualDecisionSchema,
  paginated,
  quoteListItemSchema,
  quoteListQuerySchema,
  quoteSchema,
  shareQuoteSchema,
} from '@oficinaos/shared';
import { clientInfo, getAuth } from '../../core/auth-context';

/** Rotas do orçamento dentro da oficina (docs/API.md). */
export const quoteRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = app.services.quotes;

  app.get(
    '/',
    {
      config: { auth: 'work_orders:read' },
      schema: { querystring: quoteListQuerySchema, response: { 200: paginated(quoteListItemSchema) } },
    },
    async (request) => service.list(getAuth(request), request.query),
  );

  app.get(
    '/:id',
    { config: { auth: 'work_orders:read' }, schema: { params: idParamSchema, response: { 200: quoteSchema } } },
    async (request) => service.get(getAuth(request), request.params.id),
  );

  /** Devolve a mensagem pronta e o link wa.me: quem envia é a pessoa (V1). */
  app.post(
    '/:id/share',
    {
      config: { auth: 'quotes:send' },
      schema: {
        params: idParamSchema,
        body: shareQuoteSchema,
        response: {
          200: z.object({ quote: quoteSchema, message: z.string(), whatsappUrl: z.string().nullable() }),
        },
      },
    },
    async (request) => service.share(getAuth(request), request.params.id, request.body.channel, clientInfo(request)),
  );

  app.post(
    '/:id/manual-decision',
    {
      config: { auth: 'quotes:record_manual_approval' },
      schema: { params: idParamSchema, body: manualDecisionSchema, response: { 200: quoteSchema } },
    },
    async (request) => service.manualDecision(getAuth(request), request.params.id, request.body, clientInfo(request)),
  );
};

/** `POST /work-orders/{id}/quotes`: congela os itens em rascunho e gera o link. */
export const workOrderQuoteRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = app.services.quotes;

  app.post(
    '/:id/quotes',
    {
      config: { auth: 'quotes:send' },
      schema: { params: idParamSchema, body: createQuoteSchema, response: { 201: quoteSchema } },
    },
    async (request, reply) => {
      reply.code(201);
      return service.create(getAuth(request), request.params.id, request.body, clientInfo(request));
    },
  );
};
