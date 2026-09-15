/**
 * Garantias que o BANCO dá sozinho nas compras (E12). A aplicação confere tudo
 * antes, mas é aqui que um erro dela para: receber mais do que foi pedido,
 * devolver mais do que chegou, apagar a prova de um recebimento.
 */
import { sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  inventoryMovements,
  organizations,
  partPriceHistory,
  parts,
  purchaseOrderItems,
  purchaseOrders,
  purchaseReceipts,
  suppliers,
  users,
} from '../src/db/schema';
import { withoutTenant, withTenant } from '../src/db/tenant';
import * as purchasesRepo from '../src/modules/purchases/purchases.repository';
import { testDb } from './helpers';

async function violacao(promessa: Promise<unknown>): Promise<string> {
  try {
    await promessa;
  } catch (err) {
    const e = err as { cause?: { constraint?: string; code?: string; message?: string } };
    return e.cause?.constraint ?? e.cause?.code ?? e.cause?.message ?? String(err);
  }
  return 'NÃO RECUSOU';
}

describe('compras no banco', () => {
  const { db } = testDb();
  const org = uuidv7();
  const outraOrg = uuidv7();
  const gerente = uuidv7();
  const fornecedor = uuidv7();
  const fornecedorDeFora = uuidv7();
  const peca = uuidv7();
  const pedido = uuidv7();
  const pedidoDeFora = uuidv7();
  const linha = uuidv7();

  const naOficina = <T>(fn: Parameters<typeof withTenant<T>>[2]) => withTenant(db, { organizationId: org }, fn);

  beforeAll(async () => {
    await withoutTenant(db, (tx) =>
      tx.insert(users).values({ id: gerente, name: 'Gerente', email: `gerente-${gerente}@teste.local`, passwordHash: 'x' }),
    );
    await withTenant(db, { organizationId: outraOrg }, async (tx) => {
      await tx.insert(organizations).values({ id: outraOrg, name: 'Outra' });
      await tx.insert(suppliers).values({ id: fornecedorDeFora, organizationId: outraOrg, name: 'Fornecedor de fora' });
      await tx.insert(purchaseOrders).values({ id: pedidoDeFora, organizationId: outraOrg, number: 1, supplierId: fornecedorDeFora });
    });
    await naOficina(async (tx) => {
      await tx.insert(organizations).values({ id: org, name: 'Oficina' });
      await tx.insert(suppliers).values({ id: fornecedor, organizationId: org, name: 'Central Autopeças' });
      await tx.insert(parts).values({ id: peca, organizationId: org, name: 'Disco de freio' });
      await tx.insert(purchaseOrders).values({
        id: pedido,
        organizationId: org,
        number: 1,
        supplierId: fornecedor,
        status: 'ORDERED',
        orderedAt: new Date(),
      });
      await tx.insert(purchaseOrderItems).values({
        id: linha,
        organizationId: org,
        purchaseOrderId: pedido,
        partId: peca,
        description: 'Disco de freio',
        quantity: '2',
        unitCostCents: 19500,
      });
    });
  });

  // ------------------------------- a linha -----------------------------------

  it('não recebe mais do que foi pedido, nem devolve mais do que chegou', async () => {
    const aMais = await violacao(
      naOficina((tx) => tx.update(purchaseOrderItems).set({ receivedQuantity: '2.001' }).where(sql`id = ${linha}`)),
    );
    expect(aMais).toBe('purchase_order_items_received_check');

    await naOficina((tx) => tx.update(purchaseOrderItems).set({ receivedQuantity: '1' }).where(sql`id = ${linha}`));
    const devolveDemais = await violacao(
      naOficina((tx) => tx.update(purchaseOrderItems).set({ returnedQuantity: '1.5' }).where(sql`id = ${linha}`)),
    );
    expect(devolveDemais).toBe('purchase_order_items_returned_check');

    // a peça errada voltou e a certa chegou: 3 recebidas, 1 devolvida, pedido de 2 — vale
    await naOficina((tx) =>
      tx.update(purchaseOrderItems).set({ receivedQuantity: '3', returnedQuantity: '1' }).where(sql`id = ${linha}`),
    );
    // mas o líquido não passa do pedido
    const liquidoDemais = await violacao(
      naOficina((tx) => tx.update(purchaseOrderItems).set({ receivedQuantity: '4' }).where(sql`id = ${linha}`)),
    );
    expect(liquidoDemais).toBe('purchase_order_items_received_check');
    await naOficina((tx) =>
      tx.update(purchaseOrderItems).set({ receivedQuantity: '1', returnedQuantity: '0' }).where(sql`id = ${linha}`),
    );
  });

  it('linha sem quantidade ou com custo negativo é recusada', async () => {
    const base = { organizationId: org, purchaseOrderId: pedido, partId: peca, description: 'X' };
    expect(await violacao(naOficina((tx) => tx.insert(purchaseOrderItems).values({ ...base, quantity: '0', unitCostCents: 1 })))).toBe(
      'purchase_order_items_quantity_check',
    );
    expect(await violacao(naOficina((tx) => tx.insert(purchaseOrderItems).values({ ...base, quantity: '1', unitCostCents: -1 })))).toBe(
      'purchase_order_items_cost_check',
    );
  });

  /**
   * Receber, devolver, pedir e cancelar leem as linhas e gravam a soma. Duas
   * requisições em paralelo NÃO provam a trava (a primeira costuma terminar antes
   * da segunda ler — a mutação que tirou o lock escapou assim). Duas transações
   * de verdade provam: a segunda tem que ESPERAR a primeira.
   */
  it('lockOrder trava o pedido: a segunda transação espera o lock', async () => {
    let travou!: () => void;
    const adquirido = new Promise<void>((resolve) => {
      travou = resolve;
    });
    let soltar!: () => void;
    const segurando = new Promise<void>((resolve) => {
      soltar = resolve;
    });

    const primeira = naOficina(async (tx) => {
      await purchasesRepo.lockOrder(tx, org, pedido);
      travou();
      await segurando;
    });
    await adquirido;

    const segunda = naOficina(async (tx) => {
      await tx.execute(sql`set local statement_timeout = '400ms'`);
      return purchasesRepo.lockOrder(tx, org, pedido);
    });
    // 57014 = statement_timeout: ficou esperando o lock da primeira, como tem que ser
    await expect(segunda).rejects.toMatchObject({ cause: { code: '57014' } });

    soltar();
    await primeira;
  });

  // ------------------------------- o pedido ----------------------------------

  it('pedido fora do rascunho precisa da data em que foi feito', async () => {
    const erro = await violacao(
      naOficina((tx) => tx.insert(purchaseOrders).values({ organizationId: org, number: 2, supplierId: fornecedor, status: 'ORDERED' })),
    );
    expect(erro).toBe('purchase_orders_ordered_check');
  });

  it('cancelado sem data ou sem motivo é recusado — e data de cancelamento sem cancelar também', async () => {
    const semMotivo = await violacao(
      naOficina((tx) =>
        tx.insert(purchaseOrders).values({ organizationId: org, number: 3, supplierId: fornecedor, status: 'CANCELED', canceledAt: new Date() }),
      ),
    );
    expect(semMotivo).toBe('purchase_orders_canceled_check');
    const semData = await violacao(
      naOficina((tx) =>
        tx.insert(purchaseOrders).values({ organizationId: org, number: 4, supplierId: fornecedor, status: 'CANCELED', cancelReason: 'x' }),
      ),
    );
    expect(semData).toBe('purchase_orders_canceled_check');
    const dataSemCancelar = await violacao(
      naOficina((tx) =>
        tx.insert(purchaseOrders).values({ organizationId: org, number: 5, supplierId: fornecedor, canceledAt: new Date(), cancelReason: 'x' }),
      ),
    );
    expect(dataSemCancelar).toBe('purchase_orders_canceled_check');
  });

  it('pedido não aponta para fornecedor de outra oficina', async () => {
    const erro = await violacao(
      naOficina((tx) => tx.insert(purchaseOrders).values({ organizationId: org, number: 6, supplierId: fornecedorDeFora })),
    );
    expect(erro).toBe('purchase_orders_supplier_fk');
  });

  // ---------------------------- o recebimento --------------------------------

  it('a mesma chave de recebimento não entra duas vezes', async () => {
    const chave = uuidv7();
    const recebimento = { organizationId: org, purchaseOrderId: pedido, clientRequestId: chave, receivedBy: gerente };
    await naOficina((tx) => tx.insert(purchaseReceipts).values(recebimento));
    expect(await violacao(naOficina((tx) => tx.insert(purchaseReceipts).values(recebimento)))).toBe(
      'purchase_receipts_client_request_unique',
    );
  });

  it('recebimento e devolução são append-only para a aplicação', async () => {
    const { rows } = await db.execute<{ tabela: string; update: boolean; delete: boolean; insert: boolean }>(sql`
      select t.tabela,
             has_table_privilege(current_user, t.tabela, 'UPDATE') as update,
             has_table_privilege(current_user, t.tabela, 'DELETE') as delete,
             has_table_privilege(current_user, t.tabela, 'INSERT') as insert
      from (values ('purchase_receipts'), ('purchase_receipt_items'), ('purchase_returns'), ('purchase_return_items')) as t(tabela)
    `);
    expect(rows).toEqual([
      { tabela: 'purchase_receipts', update: false, delete: false, insert: true },
      { tabela: 'purchase_receipt_items', update: false, delete: false, insert: true },
      { tabela: 'purchase_returns', update: false, delete: false, insert: true },
      { tabela: 'purchase_return_items', update: false, delete: false, insert: true },
    ]);
  });

  // ---------------------- o que as outras tabelas ganham ---------------------

  it('movimento de estoque não aponta para compra de outra oficina', async () => {
    const erro = await violacao(
      naOficina((tx) =>
        tx.insert(inventoryMovements).values({
          organizationId: org,
          partId: peca,
          type: 'PURCHASE_IN',
          quantity: '1',
          unitCostCents: 100,
          balanceAfter: '1',
          purchaseOrderId: pedidoDeFora,
        }),
      ),
    );
    expect(erro).toBe('inventory_movements_purchase_order_fk');
  });

  it('preço de compra no histórico precisa dizer de que compra veio', async () => {
    const erro = await violacao(
      naOficina((tx) =>
        tx.insert(partPriceHistory).values({ organizationId: org, partId: peca, supplierId: fornecedor, priceCents: 19500, source: 'PURCHASE' }),
      ),
    );
    expect(erro).toBe('part_price_history_origin_check');
    await naOficina((tx) =>
      tx.insert(partPriceHistory).values({
        organizationId: org,
        partId: peca,
        supplierId: fornecedor,
        priceCents: 19500,
        source: 'PURCHASE',
        purchaseOrderId: pedido,
      }),
    );
  });

  it('a oficina de fora não vê pedido, linha nem recebimento', async () => {
    const vistos = await withTenant(db, { organizationId: outraOrg }, async (tx) => ({
      pedidos: await tx.select().from(purchaseOrders),
      linhas: await tx.select().from(purchaseOrderItems),
      recebimentos: await tx.select().from(purchaseReceipts),
    }));
    expect(vistos.pedidos.map((p) => p.id)).toEqual([pedidoDeFora]);
    expect(vistos.linhas).toEqual([]);
    expect(vistos.recebimentos).toEqual([]);
  });
});
