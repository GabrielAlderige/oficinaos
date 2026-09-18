import { z } from 'zod';
import { MAX_ITEMS_PER_PURCHASE_ORDER, PURCHASE_ORDER_STATUSES } from '../enums/purchases';
import { quantitySchema } from './catalog';
import { optionalText } from './common';
import { listQuerySchema } from './pagination';

const cents = z.number().int().min(0).max(100_000_000);
const dateOnly = z.iso.date('Data inválida');

// ================================ entrada ===================================

/**
 * Uma linha do pedido. A tela manda a peça, a quantidade e o custo combinado;
 * nome e código saem do cadastro da peça, pela API.
 */
export const purchaseOrderLineInputSchema = z.object({
  partId: z.uuid(),
  quantity: quantitySchema.refine((valor) => valor > 0, 'Quantidade precisa ser maior que zero'),
  unitCostCents: cents,
  /** a peça é para esta OS: ao chegar, fica reservada para ela */
  workOrderItemId: z.uuid().nullable().default(null),
});

const lines = z
  .array(purchaseOrderLineInputSchema)
  .min(1, 'Adicione pelo menos uma peça')
  .max(MAX_ITEMS_PER_PURCHASE_ORDER, `Até ${MAX_ITEMS_PER_PURCHASE_ORDER} peças por pedido`)
  .superRefine((itens, ctx) => {
    const vistos = new Set<string>();
    itens.forEach((item, indice) => {
      if (!item.workOrderItemId) return;
      if (vistos.has(item.workOrderItemId)) {
        ctx.addIssue({ code: 'custom', path: [indice, 'workOrderItemId'], message: 'Peça da OS repetida no pedido' });
      }
      vistos.add(item.workOrderItemId);
    });
  });

export const createPurchaseOrderSchema = z.object({
  supplierId: z.uuid(),
  expectedOn: dateOnly.nullable().default(null),
  shippingCents: cents.default(0),
  notes: optionalText(1000).default(''),
  items: lines,
});

/** Só no rascunho. As linhas, quando vêm, substituem todas as anteriores. */
export const updatePurchaseOrderSchema = z.object({
  version: z.number().int().min(1),
  supplierId: z.uuid().optional(),
  expectedOn: dateOnly.nullable().optional(),
  shippingCents: cents.optional(),
  notes: optionalText(1000).optional(),
  items: lines.optional(),
});

/** Marca como pedido ao fornecedor: as linhas congelam. */
export const orderPurchaseOrderSchema = z.object({
  version: z.number().int().min(1),
  expectedOn: dateOnly.nullable().optional(),
});

export const cancelPurchaseOrderSchema = z.object({
  reason: z.string().trim().min(3, 'Explique o motivo do cancelamento').max(200),
});

/** "O resto não vem": encerra o pedido com o que chegou. */
export const closePurchaseOrderSchema = z.object({
  reason: z.string().trim().min(3, 'Explique por que o resto não vem').max(200),
});

const positiveQuantity = quantitySchema.refine((valor) => valor > 0, 'Quantidade precisa ser maior que zero');

const semLinhaRepetida = <T extends { purchaseOrderItemId: string }>(itens: T[], ctx: z.RefinementCtx) => {
  const vistos = new Set<string>();
  itens.forEach((item, indice) => {
    if (vistos.has(item.purchaseOrderItemId)) {
      ctx.addIssue({ code: 'custom', path: [indice, 'purchaseOrderItemId'], message: 'Peça repetida' });
    }
    vistos.add(item.purchaseOrderItemId);
  });
};

/**
 * A chegada da mercadoria. `clientRequestId` é gerado pela tela uma vez por
 * formulário: repetir o envio (clique duplo, rede instável) não dá entrada duas vezes.
 * O custo é o da nota, por linha — pode diferir do combinado.
 */
export const receivePurchaseOrderSchema = z.object({
  clientRequestId: z.uuid(),
  invoiceNumber: optionalText(60).default(''),
  notes: optionalText(500).default(''),
  /** frete desta entrega: é rateado no custo das peças que chegaram */
  shippingCents: cents.default(0),
  /**
   * Vencimento da conta a pagar que nasce desta nota (E13). Vazio = à vista, e
   * a conta vence hoje.
   */
  payableDueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida')
    .nullable()
    .default(null),
  items: z
    .array(z.object({ purchaseOrderItemId: z.uuid(), quantity: positiveQuantity, unitCostCents: cents }))
    .min(1, 'Informe o que chegou')
    .max(MAX_ITEMS_PER_PURCHASE_ORDER)
    .superRefine(semLinhaRepetida),
});

/** Devolução ao fornecedor: a correção de um recebimento (decisão de 14/09/2026). */
export const returnPurchaseOrderSchema = z.object({
  clientRequestId: z.uuid(),
  reason: z.string().trim().min(3, 'Explique o motivo da devolução').max(200),
  items: z
    .array(z.object({ purchaseOrderItemId: z.uuid(), quantity: positiveQuantity }))
    .min(1, 'Informe o que volta')
    .max(MAX_ITEMS_PER_PURCHASE_ORDER)
    .superRefine(semLinhaRepetida),
});

/** Um rascunho por fornecedor, com as ofertas escolhidas na cotação (E11). */
export const purchaseOrdersFromQuoteSchema = z.object({
  supplierQuoteRequestId: z.uuid(),
});

export const PURCHASE_ORDER_LIST_FILTERS = ['open', 'all', ...PURCHASE_ORDER_STATUSES] as const;

export const purchaseOrderListQuerySchema = listQuerySchema.extend({
  status: z.enum(PURCHASE_ORDER_LIST_FILTERS).default('open'),
  supplierId: z.uuid().optional(),
});

// ================================= saída ====================================

const person = z.object({ id: z.uuid(), name: z.string() }).nullable();

export const purchaseOrderLineSchema = z.object({
  id: z.uuid(),
  partId: z.uuid(),
  description: z.string(),
  partCode: z.string().nullable(),
  unit: z.string(),
  quantity: z.number(),
  unitCostCents: z.number().int(),
  lineTotalCents: z.number().int(),
  receivedQuantity: z.number(),
  returnedQuantity: z.number(),
  /** o que ainda falta chegar: pedido − (recebido − devolvido) */
  pendingQuantity: z.number(),
  /** a OS para a qual a peça foi comprada */
  workOrder: z
    .object({ id: z.uuid(), number: z.number().int(), itemId: z.uuid(), vehicleLabel: z.string() })
    .nullable(),
  supplierQuoteAwardId: z.uuid().nullable(),
});

export const purchaseOrderSchema = z.object({
  id: z.uuid(),
  number: z.number().int(),
  status: z.enum(PURCHASE_ORDER_STATUSES),
  supplier: z.object({
    id: z.uuid(),
    name: z.string(),
    whatsapp: z.string().nullable(),
    contactName: z.string().nullable(),
    /** tirado da lista depois do pedido: o histórico continua mostrando de quem foi */
    removed: z.boolean(),
  }),
  supplierQuote: z.object({ id: z.uuid(), number: z.number().int() }).nullable(),
  expectedOn: z.string().nullable(),
  shippingCents: z.number().int(),
  notes: z.string().nullable(),
  itemsTotalCents: z.number().int(),
  totalCents: z.number().int(),
  createdAt: z.string(),
  createdBy: person,
  orderedAt: z.string().nullable(),
  orderedBy: person,
  receivedAt: z.string().nullable(),
  closedShortAt: z.string().nullable(),
  closeReason: z.string().nullable(),
  canceledAt: z.string().nullable(),
  cancelReason: z.string().nullable(),
  version: z.number().int(),
  items: z.array(purchaseOrderLineSchema),
  receipts: z.array(
    z.object({
      id: z.uuid(),
      receivedAt: z.string(),
      receivedBy: person,
      invoiceNumber: z.string().nullable(),
      shippingCents: z.number().int(),
      notes: z.string().nullable(),
      items: z.array(
        z.object({
          purchaseOrderItemId: z.uuid(),
          description: z.string(),
          quantity: z.number(),
          /** preço da nota */
          unitCostCents: z.number().int(),
          freightCents: z.number().int(),
          /** preço + frete por unidade: o que entrou no custo médio */
          landedUnitCostCents: z.number().int(),
        }),
      ),
    }),
  ),
  returns: z.array(
    z.object({
      id: z.uuid(),
      returnedAt: z.string(),
      returnedBy: person,
      reason: z.string(),
      items: z.array(
        z.object({ purchaseOrderItemId: z.uuid(), description: z.string(), quantity: z.number(), unitCostCents: z.number().int() }),
      ),
    }),
  ),
});

export const purchaseOrderListItemSchema = z.object({
  id: z.uuid(),
  number: z.number().int(),
  status: z.enum(PURCHASE_ORDER_STATUSES),
  supplierId: z.uuid(),
  supplierName: z.string(),
  itemCount: z.number().int(),
  totalCents: z.number().int(),
  expectedOn: z.string().nullable(),
  createdAt: z.string(),
  orderedAt: z.string().nullable(),
  workOrderNumbers: z.array(z.number().int()),
});

/** Pedido marcado como feito: a mensagem pronta para mandar ao fornecedor. */
export const orderedPurchaseOrderSchema = z.object({
  order: purchaseOrderSchema,
  message: z.string(),
  whatsappUrl: z.string().nullable(),
});

export const purchaseOrdersFromQuoteResultSchema = z.object({
  orders: z.array(purchaseOrderSchema),
  /** o que ficou de fora, com o motivo em português */
  skipped: z.array(z.object({ description: z.string(), reason: z.string() })),
});

/** As compras de uma OS, na ficha dela. */
export const workOrderPurchaseLineSchema = z.object({
  purchaseOrderId: z.uuid(),
  purchaseOrderNumber: z.number().int(),
  status: z.enum(PURCHASE_ORDER_STATUSES),
  supplierName: z.string(),
  workOrderItemId: z.uuid(),
  description: z.string(),
  quantity: z.number(),
  receivedQuantity: z.number(),
  expectedOn: z.string().nullable(),
});

/**
 * Sugestão de compra: o que repor do estoque mínimo e o que as OS esperam,
 * agrupado pelo fornecedor preferido da peça. É sugestão — a pessoa ajusta e
 * cria o rascunho.
 */
export const PURCHASE_SUGGESTION_KINDS = ['RESTOCK', 'WORK_ORDER'] as const;

export const purchaseSuggestionsSchema = z.object({
  groups: z.array(
    z.object({
      supplier: z.object({ id: z.uuid(), name: z.string() }).nullable(),
      items: z.array(
        z.object({
          kind: z.enum(PURCHASE_SUGGESTION_KINDS),
          partId: z.uuid(),
          partName: z.string(),
          partCode: z.string().nullable(),
          unit: z.string(),
          quantity: z.number(),
          /** último custo pago (ou o médio); null quando nunca houve */
          unitCostCents: z.number().int().nullable(),
          workOrderItemId: z.uuid().nullable(),
          workOrderNumber: z.number().int().nullable(),
          /** por que entrou: "abaixo do mínimo (disponível 1 de 4)", "OS 12, aprovada" */
          reason: z.string(),
        }),
      ),
    }),
  ),
});

/** O que a oficina já fez com um fornecedor: cotações e (para quem vê custo) compras. */
export const supplierHistorySchema = z.object({
  quotes: z.array(
    z.object({
      id: z.uuid(),
      number: z.number().int(),
      status: z.string(),
      createdAt: z.string(),
      workOrderNumber: z.number().int().nullable(),
      answered: z.boolean(),
    }),
  ),
  /** null para quem não vê compras (é custo) */
  purchases: z
    .array(
      z.object({
        id: z.uuid(),
        number: z.number().int(),
        status: z.enum(PURCHASE_ORDER_STATUSES),
        createdAt: z.string(),
        totalCents: z.number().int(),
        itemCount: z.number().int(),
      }),
    )
    .nullable(),
});

/** Quanto cada fornecedor cobrou pela peça, ao longo do tempo (cotação e compra). */
export const partPriceHistorySchema = z.object({
  data: z.array(
    z.object({
      id: z.uuid(),
      capturedAt: z.string(),
      supplier: z.object({ id: z.uuid(), name: z.string() }).nullable(),
      priceCents: z.number().int(),
      source: z.string(),
      purchaseOrder: z.object({ id: z.uuid(), number: z.number().int() }).nullable(),
      supplierQuote: z.object({ id: z.uuid(), number: z.number().int(), workOrderNumber: z.number().int().nullable() }).nullable(),
    }),
  ),
});

export type PurchaseSuggestions = z.infer<typeof purchaseSuggestionsSchema>;
export type SupplierHistory = z.infer<typeof supplierHistorySchema>;
export type PartPriceHistory = z.infer<typeof partPriceHistorySchema>;
export type PurchaseOrderLineInput = z.input<typeof purchaseOrderLineInputSchema>;
export type CreatePurchaseOrderInput = z.output<typeof createPurchaseOrderSchema>;
export type UpdatePurchaseOrderInput = z.output<typeof updatePurchaseOrderSchema>;
export type OrderPurchaseOrderInput = z.output<typeof orderPurchaseOrderSchema>;
export type ReceivePurchaseOrderInput = z.output<typeof receivePurchaseOrderSchema>;
export type ReturnPurchaseOrderInput = z.output<typeof returnPurchaseOrderSchema>;
export type CancelPurchaseOrderInput = z.output<typeof cancelPurchaseOrderSchema>;
export type ClosePurchaseOrderInput = z.output<typeof closePurchaseOrderSchema>;
export type PurchaseOrderListQuery = z.output<typeof purchaseOrderListQuerySchema>;
export type PurchaseOrderListFilter = (typeof PURCHASE_ORDER_LIST_FILTERS)[number];
export type PurchaseOrder = z.infer<typeof purchaseOrderSchema>;
export type PurchaseOrderLine = z.infer<typeof purchaseOrderLineSchema>;
export type PurchaseOrderListItem = z.infer<typeof purchaseOrderListItemSchema>;
export type OrderedPurchaseOrder = z.infer<typeof orderedPurchaseOrderSchema>;
export type PurchaseOrdersFromQuoteResult = z.infer<typeof purchaseOrdersFromQuoteResultSchema>;
export type WorkOrderPurchaseLine = z.infer<typeof workOrderPurchaseLineSchema>;
