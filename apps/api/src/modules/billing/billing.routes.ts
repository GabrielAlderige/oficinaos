import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  billingOverviewSchema,
  cancelSubscriptionSchema,
  changePlanSchema,
  startSubscriptionSchema,
} from '@oficinaos/shared';
import { clientInfo, getAuth } from '../../core/auth-context';

/**
 * Assinatura do SaaS (E20). Só quem tem `billing:manage` mexe — hoje, o dono.
 *
 * Todas as rotas daqui declaram `allowBlocked`: a oficina com a assinatura
 * vencida precisa **exatamente** destas telas para voltar ao normal. Bloquear
 * a porta de pagar seria bloquear a própria cobrança.
 */
export const billingRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = app.services.billing;

  app.get(
    '/',
    {
      config: { auth: 'billing:manage', allowBlocked: true },
      schema: { response: { 200: billingOverviewSchema } },
    },
    async (request) => service.overview(getAuth(request)),
  );

  app.post(
    '/subscribe',
    {
      config: { auth: 'billing:manage', allowBlocked: true },
      schema: { body: startSubscriptionSchema, response: { 200: billingOverviewSchema } },
    },
    async (request) => service.start(getAuth(request), request.body, clientInfo(request)),
  );

  app.post(
    '/change-plan',
    {
      config: { auth: 'billing:manage', allowBlocked: true },
      schema: { body: changePlanSchema, response: { 200: billingOverviewSchema } },
    },
    async (request) => service.changePlan(getAuth(request), request.body, clientInfo(request)),
  );

  app.post(
    '/cancel',
    {
      config: { auth: 'billing:manage', allowBlocked: true },
      schema: { body: cancelSubscriptionSchema, response: { 200: billingOverviewSchema } },
    },
    async (request) => service.cancel(getAuth(request), request.body, clientInfo(request)),
  );

  app.post(
    '/resume',
    {
      config: { auth: 'billing:manage', allowBlocked: true },
      schema: { response: { 200: billingOverviewSchema } },
    },
    async (request) => service.resume(getAuth(request), clientInfo(request)),
  );
};
