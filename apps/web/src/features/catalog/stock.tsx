import { formatQuantity, PART_UNIT_SHORT, STOCK_STATUS_LABELS, type PartUnit, type StockStatus } from '@oficinaos/shared';
import { Badge } from '../../components/ui/display';

const TONES = {
  NOT_TRACKED: 'neutral',
  NEGATIVE: 'danger',
  OUT: 'danger',
  LOW: 'warning',
  OK: 'success',
} as const satisfies Record<StockStatus, 'neutral' | 'danger' | 'warning' | 'success'>;

export function StockBadge({ status }: { status: StockStatus }) {
  return <Badge tone={TONES[status]}>{STOCK_STATUS_LABELS[status]}</Badge>;
}

/** 4.5 + L → "4,5 L". A API manda número com até 3 casas; o arredondamento tira o ruído do float. */
export const formatQty = (value: number, unit: PartUnit) =>
  formatQuantity(Math.round(value * 1000), PART_UNIT_SHORT[unit]);

const inputFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3, useGrouping: false });

/** Número da API → texto do campo (4.5 → "4,5"; 0 → vazio). */
export const quantityInput = (value: number | null) => (value ? inputFormat.format(value) : '');
