import { and, eq, inArray, isNull, ne, type SQL } from 'drizzle-orm';
import { sessions } from '../db/schema';
import type { Tx } from '../db/tenant';

export interface SessionFilter {
  ids?: string[];
  userId?: string;
  /** só as sessões cuja oficina ativa é esta */
  organizationId?: string;
  exceptId?: string;
}

export type RevokeReason =
  | 'LOGOUT'
  | 'USER_REVOKED'
  | 'PASSWORD_RESET'
  | 'REFRESH_TOKEN_REUSE'
  | 'MEMBERSHIP_INACTIVE'
  | 'MEMBERSHIP_REMOVED';

/**
 * Encerra sessões e devolve os ids afetados (para limpar o cache da API).
 * Infraestrutura comum a auth e equipe: desativar alguém derruba o acesso na hora.
 */
export async function revokeSessions(tx: Tx, filter: SessionFilter, reason: RevokeReason): Promise<string[]> {
  const conditions: SQL[] = [isNull(sessions.revokedAt)];
  if (filter.ids) {
    if (!filter.ids.length) return [];
    conditions.push(inArray(sessions.id, filter.ids));
  }
  if (filter.userId) conditions.push(eq(sessions.userId, filter.userId));
  if (filter.organizationId) conditions.push(eq(sessions.activeOrganizationId, filter.organizationId));
  if (filter.exceptId) conditions.push(ne(sessions.id, filter.exceptId));
  if (conditions.length === 1) throw new Error('revokeSessions sem filtro revogaria todas as sessões');

  const rows = await tx
    .update(sessions)
    .set({ revokedAt: new Date(), revokedReason: reason })
    .where(and(...conditions))
    .returning({ id: sessions.id });
  return rows.map((r) => r.id);
}
