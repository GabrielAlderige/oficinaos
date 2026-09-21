import type { FastifyRequest } from 'fastify';
import { bloqueiaEscrita, can, ErrorCode, situacaoDaAssinatura } from '@oficinaos/shared';
import { withoutTenant } from '../../db/tenant';
import type { Database } from '../../db/client';
import { sessions } from '../../db/schema';
import { eq } from 'drizzle-orm';
import type { AccessTokens } from '../../modules/auth/tokens';
import type { AuthService } from '../../modules/auth/auth.service';
import type { AuthCaches, AuthContext, SessionState } from '../auth-context';
import { AppError, forbidden, unauthorized } from '../errors';

interface GuardDeps {
  db: Database;
  tokens: AccessTokens;
  caches: AuthCaches;
  auth: AuthService;
}

/**
 * Hook global de autorização. Cada rota declara `config.auth`:
 *   'public' | 'authenticated' | '<permissão>' (ex.: 'team:manage').
 * Sem declaração vale 'authenticated': fecha por padrão.
 */
export function createAuthGuard({ db, tokens, caches, auth }: GuardDeps) {
  async function loadSession(sessionId: string): Promise<SessionState | undefined> {
    const cached = caches.sessions.get(sessionId);
    if (cached) return cached;
    const [row] = await withoutTenant(db, (tx) =>
      tx
        .select({ userId: sessions.userId, revokedAt: sessions.revokedAt, expiresAt: sessions.expiresAt })
        .from(sessions)
        .where(eq(sessions.id, sessionId))
        .limit(1),
    );
    if (row) caches.sessions.set(sessionId, row);
    return row;
  }

  async function authenticate(request: FastifyRequest): Promise<AuthContext> {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw unauthorized();

    const claims = await tokens.verify(header.slice('Bearer '.length));
    if (!claims) throw unauthorized('Sua sessão expirou. Entre novamente.');

    const session = await loadSession(claims.sessionId);
    if (!session || session.revokedAt || session.expiresAt <= new Date() || session.userId !== claims.userId) {
      throw unauthorized('Sua sessão foi encerrada. Entre novamente.');
    }

    const membership = await auth.membershipState(claims.organizationId, claims.userId);
    if (!membership?.isActive || !membership.organizationActive) {
      throw unauthorized('Seu acesso a esta oficina foi desativado.');
    }

    return {
      userId: claims.userId,
      organizationId: claims.organizationId,
      sessionId: claims.sessionId,
      role: membership.role,
    };
  }

  const ESCRITA = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

  /**
   * Assinatura vencida trava a ESCRITA, nunca a leitura (E20). A oficina
   * continua vendo tudo o que é dela — cliente, OS, histórico — e continua
   * conseguindo pagar: as rotas de cobrança e de sair da conta declaram
   * `allowBlocked`. Trancar o dado de quem atrasou um boleto é sequestro de
   * dado, não cobrança.
   */
  async function assertNaoBloqueada(request: FastifyRequest, organizationId: string): Promise<void> {
    if (!ESCRITA.has(request.method)) return;
    if (request.routeOptions.config.allowBlocked) return;

    const estado = await auth.subscriptionState(organizationId);
    if (!estado) return;
    const situacao = situacaoDaAssinatura(estado);
    if (!bloqueiaEscrita(situacao)) return;

    throw new AppError(
      402,
      ErrorCode.SUBSCRIPTION_BLOCKED,
      situacao.status === 'TRIALING' ? 'O período de teste terminou' : 'Assinatura em aberto',
      'A oficina continua com tudo salvo e visível, mas para voltar a gravar é preciso acertar a assinatura em Configurações → Plano.',
    );
  }

  return async function authGuard(request: FastifyRequest): Promise<void> {
    if (request.is404) return;
    const rule = request.routeOptions.config.auth ?? 'authenticated';
    if (rule === 'public') return;

    request.auth = await authenticate(request);
    if (rule !== 'authenticated' && !can(request.auth.role, rule)) throw forbidden();
    await assertNaoBloqueada(request, request.auth.organizationId);
  };
}
