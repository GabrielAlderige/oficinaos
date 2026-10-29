import { describe, expect, it } from 'vitest';
import { ACTIVE_WORK_ORDER_STATUSES, PATIO_COLUMNS } from './enums/work-orders';

describe('pátio em colunas (E49)', () => {
  it('cada carro na oficina cai em exatamente uma coluna', () => {
    const todas = PATIO_COLUMNS.flatMap((coluna) => [...coluna.statuses]);
    expect([...todas].sort()).toEqual([...ACTIVE_WORK_ORDER_STATUSES].sort());
    expect(new Set(todas).size).toBe(todas.length);
  });

  it('entregue e cancelada não aparecem no pátio', () => {
    const todas: string[] = PATIO_COLUMNS.flatMap((coluna) => [...coluna.statuses]);
    expect(todas).not.toContain('DELIVERED');
    expect(todas).not.toContain('CANCELED');
  });
});
