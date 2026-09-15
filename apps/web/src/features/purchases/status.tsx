import { PURCHASE_ORDER_STATUS_LABELS, PURCHASE_ORDER_STATUS_TONES, type PurchaseOrderStatus } from '@oficinaos/shared';
import { Badge } from '../../components/ui/display';

export function PurchaseStatusBadge({ status }: { status: PurchaseOrderStatus }) {
  return <Badge tone={PURCHASE_ORDER_STATUS_TONES[status]}>{PURCHASE_ORDER_STATUS_LABELS[status]}</Badge>;
}

/** "2026-09-18" → "18/09": a previsão de entrega é uma data, sem fuso. */
export const dataCurta = (iso: string) => {
  const [, mes, dia] = iso.split('-');
  return `${dia}/${mes}`;
};

/** Hoje no relógio do navegador, como "AAAA-MM-DD", para o campo de data. */
export const hojeIso = () => {
  const agora = new Date();
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}-${String(agora.getDate()).padStart(2, '0')}`;
};
