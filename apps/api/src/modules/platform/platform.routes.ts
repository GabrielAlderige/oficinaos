import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  extendTrialSchema,
  idParamSchema,
  platformOrganizationSchema,
  platformOverviewSchema,
} from '@oficinaos/shared';
import { clientInfo, getAuth } from '../../core/auth-context';

/**
 * A plataforma operando o SaaS (E41).
 *
 * `platform-admin` em tudo: é marca da CONTA, não papel de oficina. Nem o dono
 * da oficina chega aqui, do mesmo jeito que não chega no catálogo de veículos
 * (E31) nem no cadastro de tutoriais (E39).
 */
export const platformRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = app.services.platform;

  app.get(
    '/organizations',
    { config: { auth: 'platform-admin' }, schema: { response: { 200: platformOverviewSchema } } },
    async () => service.overview(),
  );

  app.post(
    '/organizations/:id/extend-trial',
    {
      config: { auth: 'platform-admin' },
      schema: {
        params: idParamSchema,
        body: extendTrialSchema,
        response: { 200: platformOrganizationSchema },
      },
    },
    async (request) =>
      service.extendTrial(getAuth(request), request.params.id, request.body, clientInfo(request)),
  );
};
