import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  commissionPayoutSchema,
  commissionQuerySchema,
  commissionReportSchema,
  createCommissionPayoutSchema,
} from '@oficinaos/shared';
import { clientInfo, getAuth } from '../../core/auth-context';

/**
 * Comissão do mecânico (E26).
 *
 * Ler exige só estar logado, de propósito: o mecânico precisa saber quanto
 * ganhou, e o serviço já limita o que cada um enxerga — quem não tem
 * `commissions:manage` vê apenas a própria comissão. **Pagar** é outra
 * conversa: mexe em dinheiro e fica com quem administra.
 */
export const commissionRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = app.services.commissions;

  app.get(
    '/',
    {
      config: { auth: 'authenticated', feature: 'commissions' },
      schema: { querystring: commissionQuerySchema, response: { 200: commissionReportSchema } },
    },
    async (request) => service.report(getAuth(request), request.query),
  );

  app.get(
    '/payouts',
    {
      config: { auth: 'authenticated', feature: 'commissions' },
      schema: { response: { 200: z.object({ data: z.array(commissionPayoutSchema) }) } },
    },
    async (request) => ({ data: await service.listPayouts(getAuth(request)) }),
  );

  app.post(
    '/payouts',
    {
      config: { auth: 'commissions:manage', feature: 'commissions' },
      schema: { body: createCommissionPayoutSchema, response: { 201: commissionPayoutSchema } },
    },
    async (request, reply) => {
      const pago = await service.pay(getAuth(request), request.body, clientInfo(request));
      return reply.code(201).send(pago);
    },
  );
};
