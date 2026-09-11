/**
 * Garantias que o BANCO dá sozinho, sem depender da API: FK composta entre
 * oficinas e unicidade da placa canônica.
 */
import { v7 as uuidv7 } from 'uuid';
import { beforeAll, describe, expect, it } from 'vitest';
import { customers, organizations, vehicles } from '../src/db/schema';
import { withTenant } from '../src/db/tenant';
import { testDb } from './helpers';

describe('clientes e veículos no banco', () => {
  const { db } = testDb();
  const orgA = uuidv7();
  const orgB = uuidv7();
  const customerA = uuidv7();
  const customerB = uuidv7();

  beforeAll(async () => {
    for (const [org, customer] of [
      [orgA, customerA],
      [orgB, customerB],
    ] as const) {
      await withTenant(db, { organizationId: org }, async (tx) => {
        await tx.insert(organizations).values({ id: org, name: `Oficina ${org.slice(-4)}` });
        await tx.insert(customers).values({ id: customer, organizationId: org, name: 'Cliente' });
      });
    }
  });

  it('FK composta: veículo da oficina A não aponta para cliente da oficina B', async () => {
    await expect(
      withTenant(db, { organizationId: orgA }, (tx) =>
        tx.insert(vehicles).values({ organizationId: orgA, customerId: customerB, make: 'VW', model: 'Gol' }),
      ),
    ).rejects.toMatchObject({ cause: { code: '23503' } }); // foreign_key_violation

    await withTenant(db, { organizationId: orgA }, (tx) =>
      tx.insert(vehicles).values({ organizationId: orgA, customerId: customerA, make: 'VW', model: 'Gol' }),
    );
  });

  it('a placa canônica é única por oficina (entre ativos)', async () => {
    const insert = (org: string, customerId: string) =>
      withTenant(db, { organizationId: org }, (tx) =>
        tx.insert(vehicles).values({ organizationId: org, customerId, make: 'Fiat', model: 'Uno', plate: 'UNI1234', plateCanonical: 'UNI1C34' }),
      );
    await insert(orgA, customerA);
    await expect(insert(orgA, customerA)).rejects.toMatchObject({ cause: { code: '23505' } });
    await insert(orgB, customerB); // outra oficina, mesma placa: permitido
  });
});
