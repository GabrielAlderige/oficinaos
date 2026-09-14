import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { publicSupplierQuoteSchema, publicSupplierResponseSchema } from '@oficinaos/shared';
import { clientInfo } from '../../core/auth-context';

const tokenParam = z.object({ token: z.string().min(16).max(128) });

/**
 * A página do fornecedor (E11). Sem login de propósito: o token de 32 bytes é a
 * credencial, e o banco só conhece o hash dele. Limite por IP em cada rota, como
 * no orçamento da E6 — 60/min para abrir, 10/min para responder.
 */
export const publicSupplierQuoteRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = app.services.supplierQuotes;

  app.get(
    '/supplier-quotes/:token',
    {
      config: { auth: 'public', rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: { params: tokenParam, response: { 200: publicSupplierQuoteSchema } },
    },
    async (request) => service.publicView(request.params.token),
  );

  app.post(
    '/supplier-quotes/:token/responses',
    {
      config: { auth: 'public', rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: { params: tokenParam, body: publicSupplierResponseSchema, response: { 200: publicSupplierQuoteSchema } },
    },
    async (request) => service.publicRespond(request.params.token, request.body, clientInfo(request)),
  );
};
