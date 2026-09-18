import { and, asc, desc, eq, gt, isNull } from 'drizzle-orm';
import { DEFAULT_PART_CATEGORIES, SYSTEM_FINANCIAL_CATEGORIES, type PlanCode } from '@oficinaos/shared';
import {
  financialCategories,
  invitations,
  memberships,
  organizations,
  partCategories,
  passwordResetTokens,
  plans,
  sessions,
  subscriptions,
  users,
} from '../../db/schema';
import type { Tx } from '../../db/tenant';

// ---- usuários (global) ----

export async function findUserByEmail(tx: Tx, email: string) {
  const [row] = await tx
    .select()
    .from(users)
    .where(and(eq(users.email, email), isNull(users.deletedAt)))
    .limit(1);
  return row;
}

export async function findUserById(tx: Tx, id: string) {
  const [row] = await tx
    .select()
    .from(users)
    .where(and(eq(users.id, id), isNull(users.deletedAt)))
    .limit(1);
  return row;
}

export async function insertUser(tx: Tx, values: typeof users.$inferInsert) {
  await tx.insert(users).values(values);
}

export async function updateUserPassword(tx: Tx, userId: string, passwordHash: string) {
  await tx.update(users).set({ passwordHash }).where(eq(users.id, userId));
}

export async function touchLastLogin(tx: Tx, userId: string) {
  await tx.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId));
}

// ---- vínculos (lidos via policy own_memberships) ----

/** Oficinas ativas do usuário, na ordem em que entrou. */
export function listUserMemberships(tx: Tx, userId: string) {
  return tx
    .select({
      organizationId: memberships.organizationId,
      organizationName: organizations.name,
      timezone: organizations.timezone,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
    .where(
      and(eq(memberships.userId, userId), eq(memberships.isActive, true), eq(organizations.status, 'ACTIVE')),
    )
    .orderBy(asc(memberships.createdAt));
}

/** Estado do vínculo para o guard de autenticação (com contexto da oficina). */
export async function findMembershipState(tx: Tx, organizationId: string, userId: string) {
  const [row] = await tx
    .select({
      role: memberships.role,
      isActive: memberships.isActive,
      organizationStatus: organizations.status,
    })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
    .where(and(eq(memberships.organizationId, organizationId), eq(memberships.userId, userId)))
    .limit(1);
  return row;
}

export async function findMembershipRow(tx: Tx, organizationId: string, userId: string) {
  const [row] = await tx
    .select()
    .from(memberships)
    .where(and(eq(memberships.organizationId, organizationId), eq(memberships.userId, userId)))
    .limit(1);
  return row;
}

export async function insertMembership(tx: Tx, values: typeof memberships.$inferInsert) {
  const [row] = await tx.insert(memberships).values(values).returning();
  return row!;
}

export async function reactivateMembership(tx: Tx, id: string, role: typeof memberships.$inferSelect.role) {
  const [row] = await tx.update(memberships).set({ isActive: true, role }).where(eq(memberships.id, id)).returning();
  return row!;
}

// ---- oficina e assinatura (cadastro) ----

export async function insertOrganization(tx: Tx, values: typeof organizations.$inferInsert) {
  await tx.insert(organizations).values(values);
}

/** As 11 categorias de peça do briefing nascem com a oficina. */
export async function insertDefaultPartCategories(tx: Tx, organizationId: string) {
  await tx
    .insert(partCategories)
    .values(DEFAULT_PART_CATEGORIES.map((name, index) => ({ organizationId, name, position: index + 1 })));
}

/** As nove categorias do financeiro (E13) nascem com a oficina. */
export async function insertDefaultFinancialCategories(tx: Tx, organizationId: string) {
  await tx
    .insert(financialCategories)
    .values(
      SYSTEM_FINANCIAL_CATEGORIES.map((categoria) => ({
        organizationId,
        direction: categoria.direction,
        name: categoria.name,
        systemKey: categoria.key,
      })),
    );
}

export async function findOrganizationName(tx: Tx, organizationId: string) {
  const [row] = await tx
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  return row?.name;
}

export async function findPlanByCode(tx: Tx, code: PlanCode) {
  const [row] = await tx.select().from(plans).where(eq(plans.code, code)).limit(1);
  return row;
}

export async function insertSubscription(tx: Tx, values: typeof subscriptions.$inferInsert) {
  await tx.insert(subscriptions).values(values);
}

export async function getSubscriptionSummary(tx: Tx, organizationId: string) {
  const [row] = await tx
    .select({
      plan: plans.code,
      planName: plans.name,
      status: subscriptions.status,
      trialEndsAt: subscriptions.trialEndsAt,
    })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(eq(subscriptions.organizationId, organizationId))
    .limit(1);
  return row;
}

// ---- sessões (global) ----

export async function insertSession(tx: Tx, values: typeof sessions.$inferInsert) {
  const [row] = await tx.insert(sessions).values(values).returning();
  return row!;
}

export async function findSessionById(tx: Tx, id: string) {
  const [row] = await tx.select().from(sessions).where(eq(sessions.id, id)).limit(1);
  return row;
}

/**
 * `FOR UPDATE`: duas renovações simultâneas com o mesmo token viram fila. A
 * segunda, ao destravar, não encontra mais o hash atual (já rotacionado) e cai
 * na janela de tolerância, em vez de rotacionar de novo e invalidar a primeira.
 */
export async function findSessionByTokenHash(tx: Tx, hash: string) {
  const [row] = await tx
    .select()
    .from(sessions)
    .where(eq(sessions.refreshTokenHash, hash))
    .limit(1)
    .for('update');
  return row;
}

export async function findSessionByPreviousHash(tx: Tx, hash: string) {
  const [row] = await tx
    .select()
    .from(sessions)
    .where(eq(sessions.previousTokenHash, hash))
    .limit(1)
    .for('update');
  return row;
}

export async function rotateSession(
  tx: Tx,
  id: string,
  values: Pick<
    typeof sessions.$inferInsert,
    'refreshTokenHash' | 'previousTokenHash' | 'rotatedAt' | 'lastUsedAt' | 'expiresAt' | 'ip' | 'userAgent'
  >,
) {
  await tx.update(sessions).set(values).where(eq(sessions.id, id));
}

export async function setSessionOrganization(tx: Tx, id: string, organizationId: string) {
  await tx.update(sessions).set({ activeOrganizationId: organizationId }).where(eq(sessions.id, id));
}

/** Sessões abertas do usuário; o nome da oficina vem pela policy member_organizations. */
export function listOpenSessions(tx: Tx, userId: string, now: Date) {
  return tx
    .select({
      id: sessions.id,
      userAgent: sessions.userAgent,
      ip: sessions.ip,
      organizationName: organizations.name,
      createdAt: sessions.createdAt,
      lastUsedAt: sessions.lastUsedAt,
    })
    .from(sessions)
    .leftJoin(organizations, eq(organizations.id, sessions.activeOrganizationId))
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, now)))
    .orderBy(desc(sessions.lastUsedAt));
}

// ---- redefinição de senha (global) ----

export async function deleteUnusedPasswordResets(tx: Tx, userId: string) {
  await tx
    .delete(passwordResetTokens)
    .where(and(eq(passwordResetTokens.userId, userId), isNull(passwordResetTokens.usedAt)));
}

export async function insertPasswordReset(tx: Tx, values: typeof passwordResetTokens.$inferInsert) {
  await tx.insert(passwordResetTokens).values(values);
}

export async function findUsablePasswordReset(tx: Tx, tokenHash: string, now: Date) {
  const [row] = await tx
    .select()
    .from(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.tokenHash, tokenHash),
        isNull(passwordResetTokens.usedAt),
        gt(passwordResetTokens.expiresAt, now),
      ),
    )
    .limit(1)
    .for('update');
  return row;
}

export async function markPasswordResetUsed(tx: Tx, id: string) {
  await tx.update(passwordResetTokens).set({ usedAt: new Date() }).where(eq(passwordResetTokens.id, id));
}

// ---- convites ----

/** Via capacidade do token (policy invitation_by_token). */
export async function findInvitationByTokenHash(tx: Tx, tokenHash: string) {
  const [row] = await tx.select().from(invitations).where(eq(invitations.tokenHash, tokenHash)).limit(1);
  return row;
}

/** Com contexto da oficina: trava o convite ainda pendente para aceitar uma vez só. */
export async function lockPendingInvitation(tx: Tx, id: string, now: Date) {
  const [row] = await tx
    .select()
    .from(invitations)
    .where(
      and(
        eq(invitations.id, id),
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
        gt(invitations.expiresAt, now),
      ),
    )
    .limit(1)
    .for('update');
  return row;
}

export async function markInvitationAccepted(tx: Tx, id: string, userId: string) {
  await tx
    .update(invitations)
    .set({ acceptedAt: new Date(), acceptedByUserId: userId })
    .where(eq(invitations.id, id));
}
