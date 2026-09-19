import type { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { Env } from '../../config/env';

/**
 * Cabeçalhos de segurança, CORS com lista explícita de origens e rate limit
 * global por IP. Rotas sensíveis (login, link público) ganham limites próprios
 * mais estritos quando nascerem.
 */
export async function registerSecurity(app: FastifyInstance, env: Env): Promise<void> {
  await app.register(helmet, {
    // a API só serve JSON: nada de conteúdo embutível em outros sites
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    referrerPolicy: { policy: 'no-referrer' },
  });

  await app.register(cors, {
    origin: env.WEB_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    exposedHeaders: ['x-request-id', 'retry-after'],
  });

  /**
   * 300 por minuto por IP em produção: é folgado para uma oficina e corta
   * abuso. Fora de produção o teto é outro porque TUDO sai do mesmo IP — a
   * suíte de ponta a ponta inteira vem de 127.0.0.1, estourava o limite no
   * meio da fila e derrubava um cenário diferente a cada rodada (a tela
   * abria e os dados vinham 429).
   */
  await app.register(rateLimit, {
    global: true,
    max: env.NODE_ENV === 'production' ? 300 : 5_000,
    timeWindow: '1 minute',
    // o handler central transforma o erro em problem+json 429
    errorResponseBuilder: (_request, context) => ({
      statusCode: 429,
      message: `Limite de ${context.max} requisições por ${context.after}`,
    }),
  });
}
