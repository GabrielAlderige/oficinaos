import { describe, expect, it } from 'vitest';
import { PURCHASE_ORDER_STATUSES, type PurchaseOrderStatus } from './enums/purchases';
import { averageCostAfterReturn, weightedAverageCost } from './inventory';
import {
  allocateFreight,
  canPurchaseAction,
  landedUnitCostCents,
  lineValueCents,
  PURCHASE_ACTIONS,
  purchaseOrderTotals,
  remainingMilli,
  returnableMilli,
  statusAfterReceipt,
  suggestedRestockMilli,
} from './purchases';

describe('ações do pedido de compra', () => {
  const pode = (status: PurchaseOrderStatus) => PURCHASE_ACTIONS.filter((acao) => canPurchaseAction(status, acao));

  it('rascunho edita, pede e cancela; não recebe nem devolve', () => {
    expect(pode('DRAFT')).toEqual(['edit', 'order', 'cancel']);
  });

  it('pedido feito recebe e cancela, mas as linhas congelam', () => {
    expect(pode('ORDERED')).toEqual(['receive', 'cancel']);
  });

  it('com parte recebida: recebe o resto, encerra o que falta ou devolve — cancelar não', () => {
    expect(pode('PARTIAL')).toEqual(['receive', 'close', 'return']);
  });

  it('recebido só devolve; cancelado não faz mais nada', () => {
    expect(pode('RECEIVED')).toEqual(['return']);
    expect(pode('CANCELED')).toEqual([]);
  });

  it('toda situação está coberta', () => {
    for (const status of PURCHASE_ORDER_STATUSES) expect(Array.isArray(pode(status))).toBe(true);
  });
});

describe('situação depois de receber', () => {
  const l = (quantityMilli: number, receivedMilli: number, returnedMilli = 0) => ({ quantityMilli, receivedMilli, returnedMilli });

  it('nada chegou, parte chegou, tudo chegou', () => {
    expect(statusAfterReceipt([l(2000, 0)])).toBe('ORDERED');
    expect(statusAfterReceipt([l(2000, 2000), l(1000, 0)])).toBe('PARTIAL');
    expect(statusAfterReceipt([l(2000, 1500), l(1000, 1000)])).toBe('PARTIAL');
    expect(statusAfterReceipt([l(2000, 2000), l(1500, 1500)])).toBe('RECEIVED');
  });

  it('devolver a peça errada reabre a espera pela certa', () => {
    // chegaram 2, 1 voltou: falta 1 de novo
    expect(statusAfterReceipt([l(2000, 2000, 1000)])).toBe('PARTIAL');
    expect(remainingMilli(l(2000, 2000, 1000))).toBe(1000);
    // voltou tudo o que chegou: é como se nada tivesse chegado
    expect(statusAfterReceipt([l(2000, 2000, 2000)])).toBe('ORDERED');
    // a substituta chegou: recebido 3, devolvido 1, pedido 2 → completo
    expect(statusAfterReceipt([l(2000, 3000, 1000)])).toBe('RECEIVED');
  });

  it('o que falta e o que ainda pode voltar nunca ficam negativos', () => {
    expect(remainingMilli(l(2000, 500))).toBe(1500);
    expect(remainingMilli(l(2000, 2500))).toBe(0);
    expect(returnableMilli({ receivedMilli: 2000, returnedMilli: 500 })).toBe(1500);
    expect(returnableMilli({ receivedMilli: 0, returnedMilli: 0 })).toBe(0);
  });
});

describe('valores do pedido', () => {
  it('linha e total com frete', () => {
    expect(lineValueCents(2000, 19500)).toBe(39000);
    // 1,5 L × R$ 45,99 = R$ 68,985 → R$ 68,99
    expect(lineValueCents(1500, 4599)).toBe(6899);
    expect(
      purchaseOrderTotals(
        [
          { quantityMilli: 2000, unitCostCents: 19500 },
          { quantityMilli: 1000, unitCostCents: 8000 },
        ],
        1500,
      ),
    ).toEqual({ itemsTotalCents: 47000, shippingCents: 1500, totalCents: 48500 });
  });
});

describe('rateio do frete', () => {
  it('proporcional ao valor da linha', () => {
    // R$ 300 e R$ 100 dividem R$ 20 de frete: 15 e 5
    expect(allocateFreight([30000, 10000], 2000)).toEqual([1500, 500]);
  });

  it('a soma das partes é exatamente o frete, mesmo com resto', () => {
    const partes = allocateFreight([100, 100, 100], 100);
    expect(partes.reduce((a, b) => a + b, 0)).toBe(100);
    // 33,33 cada: o centavo que sobra vai para a primeira linha
    expect(partes).toEqual([34, 33, 33]);
    for (const [valores, frete] of [
      [[1, 2, 3, 4, 5, 6, 7], 997],
      [[99_999, 1], 3],
      [[12345, 67890, 11111], 2001],
    ] as const) {
      expect(allocateFreight(valores, frete).reduce((a, b) => a + b, 0), `${valores}`).toBe(frete);
    }
  });

  it('maior resto ganha o centavo, não a ordem', () => {
    // 10 × 2/3 = 6,67 e 10 × 1/3 = 3,33: o centavo vai para a linha de resto 0,67
    expect(allocateFreight([2, 1], 10)).toEqual([7, 3]);
    expect(allocateFreight([1, 2], 10)).toEqual([3, 7]);
  });

  it('sem frete, zero para todos; linhas todas zeradas dividem igual', () => {
    expect(allocateFreight([500, 700], 0)).toEqual([0, 0]);
    expect(allocateFreight([0, 0], 101)).toEqual([51, 50]);
    expect(allocateFreight([], 500)).toEqual([]);
  });
});

describe('custo que entra no estoque', () => {
  it('preço da nota mais a parte do frete por unidade', () => {
    // 2 discos a R$ 195,00 com R$ 15,00 de frete: R$ 202,50 cada
    expect(landedUnitCostCents(2000, 19500, 1500)).toBe(20250);
    // 1,5 L com R$ 3,00 de frete: R$ 2,00 por litro
    expect(landedUnitCostCents(1500, 4000, 300)).toBe(4200);
    expect(landedUnitCostCents(1000, 8000, 0)).toBe(8000);
  });
});

describe('custo médio depois de devolver ao fornecedor', () => {
  it('receber e devolver a mesma coisa volta ao médio de antes', () => {
    // 4 un a R$ 100 no estoque; chegam 2 a R$ 130 → médio R$ 110
    const depois = weightedAverageCost({ onHandMilli: 4000, averageCostCents: 10000, inMilli: 2000, unitCostCents: 13000 });
    expect(depois).toBe(11000);
    // devolve as 2 pelo custo de entrada → R$ 100 de novo
    expect(averageCostAfterReturn({ onHandMilli: 6000, averageCostCents: depois, outMilli: 2000, unitCostCents: 13000 })).toBe(10000);
  });

  it('devolvendo tudo, ou sem saldo, mantém o médio vigente', () => {
    expect(averageCostAfterReturn({ onHandMilli: 2000, averageCostCents: 13000, outMilli: 2000, unitCostCents: 13000 })).toBe(13000);
    expect(averageCostAfterReturn({ onHandMilli: -1000, averageCostCents: 13000, outMilli: 1000, unitCostCents: 13000 })).toBe(13000);
    expect(averageCostAfterReturn({ onHandMilli: 3000, averageCostCents: null, outMilli: 1000, unitCostCents: 13000 })).toBeNull();
  });

  it('conta que ficaria negativa mantém o médio em vez de zerar o custo', () => {
    // médio já baixo porque a peça saiu por OS a outro custo: não inventa custo zero
    expect(averageCostAfterReturn({ onHandMilli: 3000, averageCostCents: 1000, outMilli: 2000, unitCostCents: 9000 })).toBe(1000);
  });
});

describe('sugestão de reposição do estoque', () => {
  const r = (minMilli: number, onHandMilli: number, reservedMilli = 0, incomingMilli = 0) =>
    suggestedRestockMilli({ minMilli, onHandMilli, reservedMilli, incomingMilli });

  it('repõe até o mínimo, descontando o que está reservado', () => {
    expect(r(4000, 1000)).toBe(3000);
    // 5 na prateleira, 3 prometidas a OS: disponível 2, mínimo 4 → compra 2
    expect(r(4000, 5000, 3000)).toBe(2000);
  });

  it('o que já está pedido e não chegou conta como vindo', () => {
    expect(r(4000, 1000, 0, 2000)).toBe(1000);
    expect(r(4000, 1000, 0, 3000)).toBeNull();
  });

  it('saldo negativo pede o buraco mais o mínimo', () => {
    expect(r(2000, -1000)).toBe(3000);
  });

  it('sem mínimo, ou já no mínimo, não sugere nada', () => {
    expect(r(0, -5000)).toBeNull();
    expect(r(4000, 4000)).toBeNull();
    expect(r(4000, 6000, 1000)).toBeNull();
  });
});
