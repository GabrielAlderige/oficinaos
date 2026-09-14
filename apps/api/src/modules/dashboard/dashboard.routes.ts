import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  chartQuerySchema,
  dashboardAttentionSchema,
  dashboardChartSchema,
  dashboardQuerySchema,
  dashboardSummarySchema,
} from '@oficinaos/shared';
import { getAuth } from '../../core/auth-context';

/**
 * Dashboard (docs/API.md). Ler o painel é `dashboard:view`; os **valores em
 * dinheiro** exigem `dashboard:view_financial` e vêm como `null` para quem não
 * tem — a rota não muda, o número é que não aparece.
 */
export const dashboardRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = app.services.dashboard;

  app.get(
    '/summary',
    {
      config: { auth: 'dashboard:view' },
      schema: { querystring: dashboardQuerySchema, response: { 200: dashboardSummarySchema } },
    },
    async (request) => service.summary(getAuth(request), request.query),
  );

  app.get(
    '/attention',
    { config: { auth: 'dashboard:view' }, schema: { response: { 200: dashboardAttentionSchema } } },
    async (request) => service.attention(getAuth(request)),
  );

  app.get(
    '/charts',
    {
      config: { auth: 'dashboard:view' },
      schema: { querystring: chartQuerySchema, response: { 200: dashboardChartSchema } },
    },
    async (request) => service.chart(getAuth(request), request.query),
  );
};
