import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { automationsOverviewSchema, runAutomationSchema, updateAutomationSettingsSchema } from '@oficinaos/shared';
import { clientInfo, getAuth } from '../../core/auth-context';

/**
 * Automações (E21). Ligar, desligar e escolher horário é configuração da
 * oficina; "rodar agora" existe para a pessoa VER a automação agir sem
 * esperar o amanhecer — e para o suporte reproduzir o que ela viu.
 */
export const automationRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = app.services.automations;

  app.get(
    '/',
    { config: { auth: 'organization:manage' }, schema: { response: { 200: automationsOverviewSchema } } },
    async (request) => service.overview(getAuth(request)),
  );

  app.put(
    '/',
    {
      config: { auth: 'organization:manage' },
      schema: { body: updateAutomationSettingsSchema, response: { 200: automationsOverviewSchema } },
    },
    async (request) => service.updateSettings(getAuth(request), request.body, clientInfo(request)),
  );

  app.post(
    '/run',
    {
      config: { auth: 'organization:manage' },
      schema: { body: runAutomationSchema, response: { 200: automationsOverviewSchema } },
    },
    async (request) => service.runNow(getAuth(request), request.body.key, clientInfo(request)),
  );
};
