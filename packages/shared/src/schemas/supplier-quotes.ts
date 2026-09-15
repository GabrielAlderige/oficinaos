import { z } from 'zod';
import {
  DEFAULT_SUPPLIER_QUOTE_HOURS,
  MAX_ITEMS_PER_SUPPLIER_QUOTE,
  MAX_SUPPLIER_QUOTE_HOURS,
  MAX_SUPPLIERS_PER_QUOTE,
  OFFER_AVAILABILITIES,
  SUPPLIER_QUOTE_STATUSES,
} from '../enums/supplier-quotes';
import { optionalText } from './common';

const cents = z.number().int().min(0).max(100_000_000);

// ================================ painel ====================================

/**
 * Criar a cotação a partir da OS. A tela manda SÓ os ids: descrição, código,
 * marca e quantidade são copiados do item da OS pela API. O conteúdo que o
 * fornecedor vai ver não pode vir de quem clicou.
 */
export const createSupplierQuoteSchema = z
  .object({
    workOrderId: z.uuid(),
    workOrderItemIds: z
      .array(z.uuid())
      .min(1, 'Escolha pelo menos uma peça')
      .max(MAX_ITEMS_PER_SUPPLIER_QUOTE, `Até ${MAX_ITEMS_PER_SUPPLIER_QUOTE} peças por cotação`),
    supplierIds: z
      .array(z.uuid())
      .min(1, 'Escolha pelo menos um fornecedor')
      .max(MAX_SUPPLIERS_PER_QUOTE, `Até ${MAX_SUPPLIERS_PER_QUOTE} fornecedores por cotação`),
    /** chassi só vai quando a oficina marca (decisão de 14/09/2026) */
    includeVin: z.boolean().default(false),
    message: optionalText(500).default(''),
    expiresInHours: z.number().int().min(1).max(MAX_SUPPLIER_QUOTE_HOURS).default(DEFAULT_SUPPLIER_QUOTE_HOURS),
  })
  .superRefine((valor, ctx) => {
    if (new Set(valor.supplierIds).size !== valor.supplierIds.length) {
      ctx.addIssue({ code: 'custom', path: ['supplierIds'], message: 'Fornecedor repetido' });
    }
    if (new Set(valor.workOrderItemIds).size !== valor.workOrderItemIds.length) {
      ctx.addIssue({ code: 'custom', path: ['workOrderItemIds'], message: 'Peça repetida' });
    }
  });

/**
 * Escolher, por item, qual oferta vence. Mandar de novo para o mesmo item troca
 * a escolha (até a compra, que é da E12).
 */
export const awardSupplierQuoteSchema = z
  .object({
    awards: z
      .array(z.object({ requestItemId: z.uuid(), responseItemId: z.uuid() }))
      .min(1)
      .max(MAX_ITEMS_PER_SUPPLIER_QUOTE),
  })
  .superRefine((valor, ctx) => {
    const itens = valor.awards.map((award) => award.requestItemId);
    if (new Set(itens).size !== itens.length) {
      ctx.addIssue({ code: 'custom', path: ['awards'], message: 'Uma escolha por peça' });
    }
  });

export const cancelSupplierQuoteSchema = z.object({
  reason: z.string().trim().min(3, 'Explique o motivo do cancelamento').max(200),
});

const vehicleForSupplierSchema = z.object({
  make: z.string(),
  model: z.string(),
  version: z.string().nullable(),
  year: z.number().int().nullable(),
  engine: z.string().nullable(),
  vin: z.string().nullable(),
});

const offerItemSchema = z.object({
  id: z.uuid(),
  requestItemId: z.uuid(),
  availability: z.enum(OFFER_AVAILABILITIES),
  /** null também quando quem pede não pode ver custo */
  unitPriceCents: z.number().int().nullable(),
  brand: z.string().nullable(),
  leadTimeDays: z.number().int().nullable(),
  notes: z.string().nullable(),
});

export const supplierQuoteSchema = z.object({
  id: z.uuid(),
  number: z.number().int(),
  status: z.enum(SUPPLIER_QUOTE_STATUSES),
  /** aberta com o prazo passado: não aceita mais resposta */
  expired: z.boolean(),
  expiresAt: z.string(),
  createdAt: z.string(),
  createdByName: z.string().nullable(),
  closedAt: z.string().nullable(),
  canceledAt: z.string().nullable(),
  cancelReason: z.string().nullable(),
  workOrder: z.object({ id: z.uuid(), number: z.number().int() }).nullable(),
  vehicle: vehicleForSupplierSchema.nullable(),
  includeVin: z.boolean(),
  message: z.string().nullable(),
  /**
   * true para quem não tem `parts:view_cost` (o atendente): preço, frete, totais
   * e "mais barato" vêm vazios — decisão de 14/09/2026.
   */
  pricesHidden: z.boolean(),
  items: z.array(
    z.object({
      id: z.uuid(),
      workOrderItemId: z.uuid().nullable(),
      partId: z.uuid().nullable(),
      description: z.string(),
      partCode: z.string().nullable(),
      brand: z.string().nullable(),
      quantity: z.number(),
      unit: z.string(),
      award: z
        .object({
          responseItemId: z.uuid(),
          supplierId: z.uuid(),
          awardedAt: z.string(),
          awardedByName: z.string().nullable(),
        })
        .nullable(),
      /** o pedido de compra em que esta escolha entrou (E12); com ele, a escolha não se troca */
      purchaseOrder: z.object({ id: z.uuid(), number: z.number().int() }).nullable(),
      /** revela ordem de preço: null com os preços escondidos */
      cheapestResponseItemId: z.uuid().nullable(),
      fastestResponseItemId: z.uuid().nullable(),
      /**
       * Para decidir o preço de venda: margem da peça (ou a da oficina), preço
       * atual na OS e se o item ainda é rascunho. null com os preços escondidos.
       */
      pricing: z
        .object({
          markupBps: z.number().int(),
          workOrderUnitPriceCents: z.number().int().nullable(),
          workOrderItemDraft: z.boolean(),
        })
        .nullable(),
    }),
  ),
  invites: z.array(
    z.object({
      id: z.uuid(),
      supplier: z.object({ id: z.uuid(), name: z.string(), whatsapp: z.string().nullable() }),
      linkIssuedAt: z.string(),
      firstViewedAt: z.string().nullable(),
      lastViewedAt: z.string().nullable(),
      viewCount: z.number().int(),
      /** quantas vezes ele mandou; mais de 1 = houve correção */
      versions: z.number().int(),
      response: z
        .object({
          version: z.number().int(),
          responderName: z.string(),
          shippingCents: z.number().int().nullable(),
          notes: z.string().nullable(),
          createdAt: z.string(),
          items: z.array(offerItemSchema),
        })
        .nullable(),
    }),
  ),
  summaries: z.array(
    z.object({
      supplierId: z.uuid(),
      coveredItems: z.number().int(),
      itemsTotalCents: z.number().int(),
      shippingCents: z.number().int(),
      totalCents: z.number().int(),
    }),
  ),
});

export const supplierQuoteListItemSchema = z.object({
  id: z.uuid(),
  number: z.number().int(),
  status: z.enum(SUPPLIER_QUOTE_STATUSES),
  expired: z.boolean(),
  expiresAt: z.string(),
  createdAt: z.string(),
  itemCount: z.number().int(),
  supplierCount: z.number().int(),
  answeredCount: z.number().int(),
});

/**
 * O link sai por inteiro UMA vez, na criação ou no reenvio: o banco só guarda o
 * hash. Perdeu? Reenviar gera outro e invalida o anterior.
 */
export const issuedSupplierLinkSchema = z.object({
  inviteId: z.uuid(),
  supplierId: z.uuid(),
  supplierName: z.string(),
  link: z.string(),
  message: z.string(),
  whatsappUrl: z.string().nullable(),
});

export const createdSupplierQuoteSchema = z.object({
  quote: supplierQuoteSchema,
  links: z.array(issuedSupplierLinkSchema),
});

// ============================== fornecedor ==================================

/**
 * A resposta do fornecedor, uma linha por peça. Preço é obrigatório para quem
 * tem ou encomenda, e proibido para quem não tem — "não tenho" com preço seria
 * uma oferta fantasma no quadro comparativo.
 *
 * `contentHash` é o que ele viu: se a cotação mudou (não deveria, ela congela),
 * a API recusa em vez de gravar resposta para um conteúdo diferente.
 */
export const publicSupplierResponseSchema = z
  .object({
    contentHash: z.string().regex(/^[0-9a-f]{64}$/, 'Versão inválida'),
    responderName: z.string().trim().min(2, 'Informe o seu nome').max(120),
    shippingCents: cents.nullable().default(null),
    notes: optionalText(1000).default(''),
    items: z
      .array(
        z.object({
          requestItemId: z.uuid(),
          availability: z.enum(OFFER_AVAILABILITIES),
          unitPriceCents: z.number().int().min(1, 'Preço precisa ser maior que zero').max(100_000_000).nullable(),
          brand: optionalText(60).default(''),
          leadTimeDays: z.number().int().min(0).max(365).nullable().default(null),
          notes: optionalText(300).default(''),
        }),
      )
      .min(1)
      .max(MAX_ITEMS_PER_SUPPLIER_QUOTE),
  })
  .superRefine((valor, ctx) => {
    const vistos = new Set<string>();
    valor.items.forEach((item, indice) => {
      if (vistos.has(item.requestItemId)) {
        ctx.addIssue({ code: 'custom', path: ['items', indice, 'requestItemId'], message: 'Peça respondida duas vezes' });
      }
      vistos.add(item.requestItemId);
      if (item.availability === 'UNAVAILABLE' && item.unitPriceCents !== null) {
        ctx.addIssue({ code: 'custom', path: ['items', indice, 'unitPriceCents'], message: 'Quem não tem a peça não informa preço' });
      }
      if (item.availability !== 'UNAVAILABLE' && item.unitPriceCents === null) {
        ctx.addIssue({ code: 'custom', path: ['items', indice, 'unitPriceCents'], message: 'Informe o preço' });
      }
    });
  });

export const PUBLIC_SUPPLIER_QUOTE_STATES = ['OPEN', 'CLOSED', 'CANCELED', 'EXPIRED'] as const;

export const publicSupplierQuoteSchema = z.object({
  shopName: z.string(),
  shopPhone: z.string().nullable(),
  number: z.number().int(),
  supplierName: z.string(),
  state: z.enum(PUBLIC_SUPPLIER_QUOTE_STATES),
  answerable: z.boolean(),
  expiresAt: z.string(),
  vehicle: vehicleForSupplierSchema.nullable(),
  message: z.string().nullable(),
  contentHash: z.string(),
  items: z.array(
    z.object({
      id: z.uuid(),
      description: z.string(),
      partCode: z.string().nullable(),
      brand: z.string().nullable(),
      quantity: z.number(),
      unit: z.string(),
    }),
  ),
  /** a resposta DELE (nunca a dos outros), para preencher a correção */
  lastResponse: z
    .object({
      version: z.number().int(),
      responderName: z.string(),
      shippingCents: z.number().int().nullable(),
      notes: z.string().nullable(),
      createdAt: z.string(),
      items: z.array(offerItemSchema.omit({ id: true })),
    })
    .nullable(),
});

export type CreateSupplierQuoteInput = z.output<typeof createSupplierQuoteSchema>;
export type AwardSupplierQuoteInput = z.output<typeof awardSupplierQuoteSchema>;
export type CancelSupplierQuoteInput = z.output<typeof cancelSupplierQuoteSchema>;
export type SupplierQuote = z.infer<typeof supplierQuoteSchema>;
export type SupplierQuoteListItem = z.infer<typeof supplierQuoteListItemSchema>;
export type IssuedSupplierLink = z.infer<typeof issuedSupplierLinkSchema>;
export type CreatedSupplierQuote = z.infer<typeof createdSupplierQuoteSchema>;
export type PublicSupplierResponseInput = z.output<typeof publicSupplierResponseSchema>;
export type PublicSupplierQuote = z.infer<typeof publicSupplierQuoteSchema>;
