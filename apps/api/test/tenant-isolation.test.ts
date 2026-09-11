/**
 * Isolamento entre oficinas no nível do banco. Cada módulo novo ganha seus
 * próprios casos (ler, editar, apagar, referenciar dados de outra oficina).
 */
import { eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { beforeAll, describe, expect, it } from 'vitest';
import { activityLogs, memberships, organizations, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant';
import { testDb } from './helpers';

describe('isolamento entre oficinas (RLS)', () => {
  const { db } = testDb();
  const orgA = uuidv7();
  const orgB = uuidv7();
  const userA = uuidv7();
  const userB = uuidv7();

  beforeAll(async () => {
    await db.insert(users).values([
      { id: userA, name: 'Dono A', email: `a-${orgA}@teste.local`, passwordHash: 'x' },
      { id: userB, name: 'Dono B', email: `b-${orgB}@teste.local`, passwordHash: 'x' },
    ]);
    for (const [org, user, name] of [
      [orgA, userA, 'Oficina A'],
      [orgB, userB, 'Oficina B'],
    ] as const) {
      await withTenant(db, { organizationId: org }, async (tx) => {
        await tx.insert(organizations).values({ id: org, name });
        await tx.insert(memberships).values({ organizationId: org, userId: user, role: 'OWNER' });
        await tx.insert(activityLogs).values({
          organizationId: org,
          actorType: 'SYSTEM',
          action: 'organization.created',
          entityType: 'organization',
          entityId: org,
        });
      });
    }
  });

  it('cada oficina só enxerga os próprios dados', async () => {
    const seen = await withTenant(db, { organizationId: orgA }, async (tx) => ({
      orgs: await tx.select({ id: organizations.id }).from(organizations),
      members: await tx.select({ org: memberships.organizationId }).from(memberships),
      logs: await tx.select({ org: activityLogs.organizationId }).from(activityLogs),
    }));
    expect(seen.orgs).toEqual([{ id: orgA }]);
    expect(seen.members).toEqual([{ org: orgA }]);
    expect(seen.logs).toEqual([{ org: orgA }]);
  });

  it('sem contexto de oficina, nada de tenant é visível (falha fechado)', async () => {
    expect(await db.select().from(organizations)).toEqual([]);
    expect(await db.select().from(memberships)).toEqual([]);
    expect(await db.select().from(activityLogs)).toEqual([]);
  });

  it('não grava dado em nome de outra oficina', async () => {
    await expect(
      withTenant(db, { organizationId: orgA }, (tx) =>
        tx.insert(memberships).values({ organizationId: orgB, userId: userA, role: 'ADMIN' }),
      ),
    ).rejects.toMatchObject({ cause: { code: '42501' } }); // insufficient_privilege (violação de policy)
  });

  it('não altera nem apaga dado de outra oficina (0 linhas afetadas)', async () => {
    const result = await withTenant(db, { organizationId: orgA }, async (tx) => ({
      updated: await tx
        .update(organizations)
        .set({ name: 'invadida' })
        .where(eq(organizations.id, orgB))
        .returning(),
      deleted: await tx.delete(memberships).where(eq(memberships.organizationId, orgB)).returning(),
    }));
    expect(result).toEqual({ updated: [], deleted: [] });

    const intact = await withTenant(db, { organizationId: orgB }, (tx) =>
      tx.select({ name: organizations.name }).from(organizations),
    );
    expect(intact).toEqual([{ name: 'Oficina B' }]);
  });

  it('o contexto não vaza para a próxima transação na mesma conexão', async () => {
    await withTenant(db, { organizationId: orgA }, (tx) => tx.select().from(organizations));
    expect(await db.select().from(organizations)).toEqual([]);
  });

  it('recusa contexto que não é UUID', async () => {
    await expect(withTenant(db, { organizationId: "x' or 1=1" }, async () => 0)).rejects.toThrow(
      'UUID',
    );
  });
});
