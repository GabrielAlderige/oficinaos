import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  publicApproveSchema,
  publicQuestionSchema,
  publicQuoteRedirectSchema,
  publicQuoteSchema,
  publicRejectSchema,
} from '@oficinaos/shared';
import { clientInfo } from '../../core/auth-context';

const tokenParam = z.object({ token: z.string().min(16).max(128) });

/** Leitura e ação devolvem o mesmo corpo; substituído devolve o token novo. */
const viewResponse = z.union([publicQuoteSchema, publicQuoteRedirectSchema]);

/**
 * A página do cliente (docs/ARCHITECTURE.md §8.2). Sem login de propósito: o
 * token de 32 bytes é a credencial. Por isso cada rota tem limite próprio por
 * IP (docs/API.md §1.2) — 60/min para abrir, 10/min para agir.
 */
export const publicQuoteRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = app.services.quotes;

  app.get(
    '/quotes/:token',
    {
      config: { auth: 'public', rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: { params: tokenParam, response: { 200: viewResponse } },
    },
    async (request) => service.publicView(request.params.token, clientInfo(request)),
  );

  app.post(
    '/quotes/:token/approve',
    {
      config: { auth: 'public', rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: { params: tokenParam, body: publicApproveSchema, response: { 200: publicQuoteSchema } },
    },
    async (request) => service.publicApprove(request.params.token, request.body, clientInfo(request)),
  );

  app.post(
    '/quotes/:token/reject',
    {
      config: { auth: 'public', rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: { params: tokenParam, body: publicRejectSchema, response: { 200: publicQuoteSchema } },
    },
    async (request) => service.publicReject(request.params.token, request.body, clientInfo(request)),
  );

  app.post(
    '/quotes/:token/questions',
    {
      config: { auth: 'public', rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: { params: tokenParam, body: publicQuestionSchema, response: { 204: z.null() } },
    },
    async (request, reply) => {
      await service.publicQuestion(request.params.token, request.body.message);
      return reply.code(204).send(null);
    },
  );
};
