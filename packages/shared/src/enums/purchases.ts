/**
 * Compras (MVP 2, E12). O pedido nasce em rascunho, é marcado como feito ao
 * fornecedor e fecha quando tudo chega. Chegar em partes é normal: a
 * distribuidora manda o que tem hoje e o resto amanhã.
 *
 * - DRAFT: editável; ainda não foi ao fornecedor.
 * - ORDERED: pedido feito; as linhas congelam.
 * - PARTIAL: chegou parte.
 * - RECEIVED: chegou tudo — ou a oficina encerrou o que faltava, com motivo.
 * - CANCELED: só sem nada recebido. Com peça no estoque, corrigir é devolver.
 */
export const PURCHASE_ORDER_STATUSES = ['DRAFT', 'ORDERED', 'PARTIAL', 'RECEIVED', 'CANCELED'] as const;
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];

export const PURCHASE_ORDER_STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  DRAFT: 'Rascunho',
  ORDERED: 'Pedido feito',
  PARTIAL: 'Chegou em parte',
  RECEIVED: 'Recebido',
  CANCELED: 'Cancelado',
};

export const PURCHASE_ORDER_STATUS_TONES = {
  DRAFT: 'neutral',
  ORDERED: 'info',
  PARTIAL: 'warning',
  RECEIVED: 'success',
  CANCELED: 'danger',
} as const satisfies Record<PurchaseOrderStatus, 'neutral' | 'info' | 'warning' | 'success' | 'danger'>;

/** Ainda esperando peça chegar: o que conta como "em aberto" nas listas. */
export const OPEN_PURCHASE_ORDER_STATUSES = ['DRAFT', 'ORDERED', 'PARTIAL'] as const satisfies readonly PurchaseOrderStatus[];

export const MAX_ITEMS_PER_PURCHASE_ORDER = 100;
