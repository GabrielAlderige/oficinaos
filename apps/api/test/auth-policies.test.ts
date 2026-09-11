/**
 * As policies SÓ DE LEITURA da migration 0003 (login, seletor de oficina e
 * aceite de convite). Ampliam o que se LÊ sem oficina no contexto, e nunca o
 * que se escreve.
 */
import { eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { beforeAll, describe, expect, it } from 'vitest';
import { invitations, memberships, organizations, users } from '../src/db/schema';
import { withInviteToken, withoutTenant, withTenant, withUser } from '../src/db/tenant';
import { testDb } from './helpers';

describe('policies de leitura sem oficina no contexto', () => {
  const { db } = testDb();
  const [orgA, orgB, orgC] = [uuidv7(), uuidv7(), uuidv7()];
  const [userU, userV] = [uuidv7(), uuidv7()];
  const tokenHash = `hash-${uuidv7()}`;

  beforeAll(async () => {
    await db.insert(users).values([
      { id: userU, name: 'U', email: `u-${userU}@teste.local`, passwordHash: 'x' },
      { id: userV, name: 'V', email: `v-${userV}@teste.local`, passwordHash: 'x' },
    ]);
    const memberOf: Record<string, string[]> = { [orgA]: [userU, userV], [orgB]: [userU], [orgC]: [userV] };
    for (const [org, members] of Object.entries(memberOf)) {
      await withTenant(db, { organizationId: org }, async (tx) => {
        await tx.insert(organizations).values({ id: org, name: `Oficina ${org.slice(-4)}` });
        for (const userId of members) await tx.insert(memberships).values({ organizationId: org, userId, role: 'OWNER' });
      });
    }
    await withTenant(db, { organizationId: orgA }, (tx) =>
      tx.insert(invitations).values({
        organizationId: orgA,
        email: 'convidado@teste.local',
        role: 'MECHANIC',
        tokenHash,
        expiresAt: new Date(Date.now() + 86_400_000),
      }),
    );
  });

  it('o usuário enxerga só os próprios vínculos, em todas as oficinas', async () => {
    const rows = await withUser(db, userU, (tx) =>
      tx.select({ org: memberships.organizationId, user: memberships.userId }).from(memberships),
    );
    expect(rows.every((r) => r.user === userU)).toBe(true);
    expect(rows.map((r) => r.org).sort()).toEqual([orgA, orgB].sort());
  });

  it('enxerga o nome só das oficinas das quais participa', async () => {
    const rows = await withUser(db, userU, (tx) => tx.select({ id: organizations.id }).from(organizations));
    expect(rows.map((r) => r.id).sort()).toEqual([orgA, orgB].sort());
  });

  it('a leitura ampliada não permite se colocar em outra oficina', async () => {
    await expect(
      withUser(db, userU, (tx) =>
        tx.insert(memberships).values({ organizationId: orgC, userId: userU, role: 'OWNER' }),
      ),
    ).rejects.toMatchObject({ cause: { code: '42501' } });
  });

  it('nem alterar o próprio papel sem a oficina no contexto', async () => {
    const updated = await withUser(db, userU, (tx) =>
      tx.update(memberships).set({ role: 'MECHANIC' }).where(eq(memberships.userId, userU)).returning(),
    );
    expect(updated).toEqual([]);
  });

  it('convite: só quem apresenta o hash lê, e só aquele convite', async () => {
    expect(await withInviteToken(db, tokenHash, (tx) => tx.select().from(invitations))).toHaveLength(1);
    expect(await withInviteToken(db, 'outro-hash', (tx) => tx.select().from(invitations))).toHaveLength(0);
    expect(await withoutTenant(db, (tx) => tx.select().from(invitations))).toHaveLength(0);
  });

  it('a capacidade do convite não permite alterá-lo', async () => {
    const updated = await withInviteToken(db, tokenHash, (tx) =>
      tx.update(invitations).set({ role: 'OWNER' }).where(eq(invitations.tokenHash, tokenHash)).returning(),
    );
    expect(updated).toEqual([]);
  });
});
