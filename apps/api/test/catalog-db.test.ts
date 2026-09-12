/**
 * Garantias que o BANCO dá sozinho no catálogo: livro-razão imutável e FK
 * composta entre peça e categoria.
 */
import { sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { beforeAll, describe, expect, it } from 'vitest';
import { organizations, partCategories, parts } from '../src/db/schema';
import { withTenant } from '../src/db/tenant';
import * as partsRepo from '../src/modules/parts/parts.repository';
import { testDb } from './helpers';

describe('catálogo no banco', () => {
  const { db } = testDb();
  const orgA = uuidv7();
  const orgB = uuidv7();
  const categoryB = uuidv7();

  beforeAll(async () => {
    await withTenant(db, { organizationId: orgA }, (tx) => tx.insert(organizations).values({ id: orgA, name: 'A' }));
    await withTenant(db, { organizationId: orgB }, async (tx) => {
      await tx.insert(organizations).values({ id: orgB, name: 'B' });
      await tx.insert(partCategories).values({ id: categoryB, organizationId: orgB, name: 'Freios' });
    });
  });

  it('o livro-razão do estoque é append-only para a aplicação', async () => {
    const { rows } = await db.execute<{ can_update: boolean; can_delete: boolean; can_insert: boolean }>(sql`
      select has_table_privilege(current_user, 'inventory_movements', 'UPDATE') as can_update,
             has_table_privilege(current_user, 'inventory_movements', 'DELETE') as can_delete,
             has_table_privilege(current_user, 'inventory_movements', 'INSERT') as can_insert
    `);
    expect(rows[0]).toEqual({ can_update: false, can_delete: false, can_insert: true });
  });

  /**
   * O saldo em `parts` é cache do livro-razão: duas entradas ao mesmo tempo não
   * podem ler o mesmo saldo. Quem garante isso é o `SELECT … FOR UPDATE` do
   * `lockPart`. Movimentos em paralelo pela API não provam o lock (a suíte passa
   * sem ele); duas transações de verdade provam: a segunda tem que ESPERAR.
   */
  it('lockPart trava a peça: a segunda transação espera o lock', async () => {
    const partId = uuidv7();
    await withTenant(db, { organizationId: orgA }, (tx) =>
      tx.insert(parts).values({ id: partId, organizationId: orgA, name: 'Peça travada' }),
    );

    let lockAcquired!: () => void;
    const acquired = new Promise<void>((resolve) => {
      lockAcquired = resolve;
    });
    let releaseLock!: () => void;
    const held = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    const first = withTenant(db, { organizationId: orgA }, async (tx) => {
      await partsRepo.lockPart(tx, orgA, partId);
      lockAcquired();
      await held;
    });
    await acquired;

    const second = withTenant(db, { organizationId: orgA }, async (tx) => {
      await tx.execute(sql`set local statement_timeout = '400ms'`);
      return partsRepo.lockPart(tx, orgA, partId);
    });
    // 57014 = statement_timeout: ficou esperando o lock da primeira, como tem que ser
    await expect(second).rejects.toMatchObject({ cause: { code: '57014' } });

    releaseLock();
    await first;
  });

  it('FK composta: peça da oficina A não usa categoria da oficina B', async () => {
    await expect(
      withTenant(db, { organizationId: orgA }, (tx) =>
        tx.insert(parts).values({ organizationId: orgA, name: 'Pastilha', categoryId: categoryB }),
      ),
    ).rejects.toMatchObject({ cause: { code: '23503' } });
  });
});
