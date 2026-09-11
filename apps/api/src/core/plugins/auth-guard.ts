import type { FastifyRequest } from 'fastify';
import { can } from '@oficinaos/shared';
import { withoutTenant } from '../../db/tenant';
import type { Database } from '../../db/client';
import { sessions } from '../../db/schema';
import { eq } from 'drizzle-orm';
import type { AccessTokens } from '../../modules/auth/tokens';
import type { AuthService } from '../../modules/auth/auth.service';
import type { AuthCaches, AuthContext, SessionState } from '../auth-context';
import { forbidden, unauthorized } from '../errors';

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

  return async function authGuard(request: FastifyRequest): Promise<void> {
    if (request.is404) return;
    const rule = request.routeOptions.config.auth ?? 'authenticated';
    if (rule === 'public') return;

    request.auth = await authenticate(request);
    if (rule !== 'authenticated' && !can(request.auth.role, rule)) throw forbidden();
  };
}
