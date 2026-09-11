import { and, asc, count, desc, eq, gt, isNull } from 'drizzle-orm';
import { invitations, memberships, organizations, plans, subscriptions, users } from '../../db/schema';
import type { Tx } from '../../db/tenant';

export type MembershipRow = typeof memberships.$inferSelect;

export function listMembers(tx: Tx, organizationId: string) {
  return tx
    .select({
      id: memberships.id,
      userId: memberships.userId,
      name: users.name,
      email: users.email,
      role: memberships.role,
      isActive: memberships.isActive,
      joinedAt: memberships.createdAt,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.organizationId, organizationId))
    .orderBy(asc(memberships.createdAt));
}

export async function findMember(tx: Tx, organizationId: string, id: string) {
  const [row] = await tx
    .select({
      id: memberships.id,
      userId: memberships.userId,
      role: memberships.role,
      isActive: memberships.isActive,
      joinedAt: memberships.createdAt,
      name: users.name,
      email: users.email,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.organizationId, organizationId), eq(memberships.id, id)))
    .limit(1)
    .for('update', { of: memberships });
  return row;
}

export async function findActiveMemberByEmail(tx: Tx, organizationId: string, email: string) {
  const [row] = await tx
    .select({ id: memberships.id })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.organizationId, organizationId), eq(users.email, email), eq(memberships.isActive, true)))
    .limit(1);
  return row;
}

export async function countActiveOwners(tx: Tx, organizationId: string) {
  const [row] = await tx
    .select({ total: count() })
    .from(memberships)
    .where(
      and(eq(memberships.organizationId, organizationId), eq(memberships.role, 'OWNER'), eq(memberships.isActive, true)),
    );
  return row?.total ?? 0;
}

/** Vagas ocupadas = membros ativos + convites pendentes. */
export async function countSeats(tx: Tx, organizationId: string, now: Date) {
  const [active] = await tx
    .select({ total: count() })
    .from(memberships)
    .where(and(eq(memberships.organizationId, organizationId), eq(memberships.isActive, true)));
  const [pending] = await tx
    .select({ total: count() })
    .from(invitations)
    .where(
      and(
        eq(invitations.organizationId, organizationId),
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
        gt(invitations.expiresAt, now),
      ),
    );
  return (active?.total ?? 0) + (pending?.total ?? 0);
}

export async function findPlanLimits(tx: Tx, organizationId: string) {
  const [row] = await tx
    .select({ limits: plans.limits, planName: plans.name })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(eq(subscriptions.organizationId, organizationId))
    .limit(1);
  return row;
}

export function listPendingInvitations(tx: Tx, organizationId: string, now: Date) {
  return tx
    .select({
      id: invitations.id,
      email: invitations.email,
      role: invitations.role,
      invitedByName: users.name,
      expiresAt: invitations.expiresAt,
      createdAt: invitations.createdAt,
    })
    .from(invitations)
    .leftJoin(users, eq(users.id, invitations.invitedByUserId))
    .where(
      and(
        eq(invitations.organizationId, organizationId),
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
        gt(invitations.expiresAt, now),
      ),
    )
    .orderBy(desc(invitations.createdAt));
}

/** Reenviar convite para o mesmo e-mail invalida o link anterior. */
export async function revokePendingInvitationsForEmail(tx: Tx, organizationId: string, email: string) {
  await tx
    .update(invitations)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(invitations.organizationId, organizationId),
        eq(invitations.email, email),
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
      ),
    );
}

export async function insertInvitation(tx: Tx, values: typeof invitations.$inferInsert) {
  const [row] = await tx.insert(invitations).values(values).returning();
  return row!;
}

export async function revokeInvitation(tx: Tx, organizationId: string, id: string) {
  const [row] = await tx
    .update(invitations)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(invitations.organizationId, organizationId),
        eq(invitations.id, id),
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
      ),
    )
    .returning({ id: invitations.id, email: invitations.email });
  return row;
}

export async function updateMember(tx: Tx, id: string, patch: Partial<Pick<MembershipRow, 'role' | 'isActive'>>) {
  await tx.update(memberships).set(patch).where(eq(memberships.id, id));
}

export async function deleteMember(tx: Tx, id: string) {
  await tx.delete(memberships).where(eq(memberships.id, id));
}

export async function findOrganizationName(tx: Tx, organizationId: string) {
  const [row] = await tx
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  return row?.name ?? '';
}

export async function findUserName(tx: Tx, userId: string) {
  const [row] = await tx.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
  return row?.name ?? null;
}
