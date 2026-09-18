import {
  FINANCIAL_SITUATION_LABELS,
  FINANCIAL_SITUATION_TONES,
  type FinancialEntry,
  type FinancialSituation,
} from '@oficinaos/shared';
import { Badge } from '../../components/ui/display';

export function SituationBadge({ situation, overdueDays }: { situation: FinancialSituation; overdueDays?: number }) {
  return (
    <Badge tone={FINANCIAL_SITUATION_TONES[situation]}>
      {FINANCIAL_SITUATION_LABELS[situation]}
      {situation === 'OVERDUE' && overdueDays ? ` há ${overdueDays}d` : ''}
    </Badge>
  );
}

/** "18/09/2026" a partir da data pura, sem passar por `Date` (que traria o fuso do navegador). */
export const dataBR = (iso: string) => `${iso.slice(8)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** Hoje no relógio do navegador, como "AAAA-MM-DD", para preencher um campo de data. */
export const hojeIso = () => {
  const agora = new Date();
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}-${String(agora.getDate()).padStart(2, '0')}`;
};

/** O que a linha mostra em "de quem": cliente, fornecedor ou o documento de origem. */
export function origemDoLancamento(entry: FinancialEntry): string {
  if (entry.customerName) return entry.customerName;
  if (entry.supplierName) return entry.supplierName;
  if (entry.workOrderNumber) return `OS ${entry.workOrderNumber}`;
  if (entry.purchaseOrderNumber) return `Compra ${entry.purchaseOrderNumber}`;
  // vazio em vez de travessão: no celular a coluna vira linha, e um "–" solto
  // no meio do cartão é ruído
  return '';
}
