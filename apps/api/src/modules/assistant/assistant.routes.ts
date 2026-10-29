import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { assistantChatSchema, assistantReplySchema, assistantStatusSchema } from '@oficinaos/shared';
import { getAuth } from '../../core/auth-context';

/**
 * Assistente com IA (E49), no plano Nitro. Qualquer pessoa da equipe pode
 * perguntar: o que ela pode VER é decidido ferramenta por ferramenta, pelas
 * permissões do papel dela.
 */
export const assistantRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = app.services.assistant;

  app.get(
    '/status',
    { config: { auth: 'dashboard:view', feature: 'assistant' }, schema: { response: { 200: assistantStatusSchema } } },
    async (request) => service.status(getAuth(request)),
  );

  app.post(
    '/chat',
    {
      // cada pergunta é uma chamada paga ao modelo: além do teto do dia, um teto por minuto
      config: { auth: 'dashboard:view', feature: 'assistant', rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: { body: assistantChatSchema, response: { 200: assistantReplySchema } },
    },
    async (request) => service.chat(getAuth(request), request.body),
  );
};
