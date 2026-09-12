import { z } from 'zod';
import {
  CHECKLIST_STATES,
  DAMAGE_KINDS,
  DAMAGE_ZONES,
  DISCOUNT_MODES,
  EVENT_ACTOR_TYPES,
  INSPECTION_TYPES,
  ITEM_APPROVAL_STATUSES,
  ITEM_SOURCINGS,
  ITEM_STOCK_STATUSES,
  PAYMENT_STATUSES,
  WORK_ORDER_EVENT_TYPES,
  WORK_ORDER_ITEM_TYPES,
  WORK_ORDER_STATUSES,
} from '../enums/work-orders';
import { ATTACHMENT_KINDS, ATTACHMENT_STATUSES } from '../enums/work-orders';
import { quantitySchema } from './catalog';
import { optionalText } from './common';

const cents = z.number().int().min(0).max(100_000_000);
const positiveQuantity = quantitySchema.refine((v) => v > 0, 'A quantidade precisa ser maior que zero');
const odometer = z.number().int().min(0).max(9_999_999);

/** Data e hora em ISO. Validada pelo próprio parser, sem depender de formato exato. */
const isoDateTime = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Data inválida');

const person = z.object({ id: z.uuid(), name: z.string() });

// ------------------------------- itens da OS -------------------------------

/**
 * Item da OS. Com `serviceId`/`partId`, a API preenche nome e preço pelo
 * catálogo (serviço por hora usa a hora técnica da oficina); sem eles, é item
 * avulso e a descrição é obrigatória.
 */
export const workOrderItemInputSchema = z
  .object({
    type: z.enum(WORK_ORDER_ITEM_TYPES),
    serviceId: z.uuid().nullable().default(null),
    partId: z.uuid().nullable().default(null),
    description: optionalText(200).default(''),
    quantity: positiveQuantity.default(1),
    /** null = preço do catálogo */
    unitPriceCents: cents.nullable().default(null),
    discountCents: cents.default(0),
    /** "recomendado": o cliente pode desmarcar na página pública (E6) */
    isOptional: z.boolean().default(false),
    sourcing: z.enum(ITEM_SOURCINGS).default('STOCK'),
    mechanicUserId: z.uuid().nullable().default(null),
    estimatedMinutes: z.number().int().min(1).max(12_000).nullable().default(null),
  })
  .refine((v) => v.serviceId !== null || v.partId !== null || v.description.trim().length >= 2, {
    path: ['description'],
    message: 'Escolha do catálogo ou descreva o item',
  });

export const updateWorkOrderItemSchema = z.object({
  description: optionalText(200).optional(),
  quantity: positiveQuantity.optional(),
  unitPriceCents: cents.optional(),
  discountCents: cents.optional(),
  isOptional: z.boolean().optional(),
  sourcing: z.enum(ITEM_SOURCINGS).optional(),
  mechanicUserId: z.uuid().nullable().optional(),
  estimatedMinutes: z.number().int().min(1).max(12_000).nullable().optional(),
});

export const reorderItemsSchema = z.object({ itemIds: z.array(z.uuid()).min(1).max(200) });

// --------------------------------- a OS ---------------------------------

export const createWorkOrderSchema = z.object({
  customerId: z.uuid(),
  vehicleId: z.uuid(),
  odometerKm: odometer.nullable().default(null),
  /** relato do cliente: "barulho ao frear" */
  complaint: optionalText(2000).default(''),
  promisedAt: isoDateTime.nullable().default(null),
  advisorUserId: z.uuid().nullable().default(null),
  mechanicUserId: z.uuid().nullable().default(null),
  items: z.array(workOrderItemInputSchema).max(100).default([]),
});

const workOrderFields = {
  odometerKm: odometer.nullable(),
  complaint: optionalText(2000),
  diagnosis: optionalText(4000),
  /** aparece no orçamento e na OS impressa */
  customerNotes: optionalText(2000),
  /** só a equipe vê */
  internalNotes: optionalText(2000),
  advisorUserId: z.uuid().nullable(),
  mechanicUserId: z.uuid().nullable(),
  promisedAt: isoDateTime.nullable(),
  discountMode: z.enum(DISCOUNT_MODES).nullable(),
  /** centavos quando AMOUNT, basis points quando PERCENT */
  discountValue: z.number().int().min(0).max(100_000_000),
  surchargeCents: cents,
  warrantyDays: z.number().int().min(0).max(3650).nullable(),
  warrantyKm: z.number().int().min(0).max(1_000_000).nullable(),
};

/** `version` é obrigatória: lock otimista (atendente e mecânico editando juntos). */
export const updateWorkOrderSchema = z
  .object(workOrderFields)
  .partial()
  .extend({ version: z.number().int().min(1) });

export const cancelWorkOrderSchema = z.object({
  reason: z.string().trim().min(3, 'Explique o motivo do cancelamento').max(500),
});

export const workOrderNoteSchema = z.object({
  text: z.string().trim().min(1, 'Escreva a observação').max(2000),
});

export const workOrderListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  /** 'active' = tudo que ainda está na oficina */
  status: z.enum([...WORK_ORDER_STATUSES, 'active', 'all']).default('active'),
  mechanicId: z.uuid().optional(),
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

// ------------------------------- check-in -------------------------------

export const inspectionInputSchema = z.object({
  type: z.enum(INSPECTION_TYPES),
  odometerKm: odometer.nullable().default(null),
  /** oitavos, como o ponteiro do painel */
  fuelLevel: z.number().int().min(0).max(8).nullable().default(null),
  checklist: z
    .array(
      z.object({
        key: z.string().trim().min(1).max(60),
        label: z.string().trim().min(1).max(120),
        state: z.enum(CHECKLIST_STATES),
        note: optionalText(200).default(''),
      }),
    )
    .max(60)
    .default([]),
  damages: z
    .array(
      z.object({
        zone: z.enum(DAMAGE_ZONES),
        kind: z.enum(DAMAGE_KINDS),
        note: optionalText(200).default(''),
        attachmentId: z.uuid().nullable().default(null),
      }),
    )
    .max(60)
    .default([]),
  accessories: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
  notes: optionalText(2000).default(''),
});

/**
 * Corpo do check-in. A confirmação de km menor é só de ENTRADA: não entra no
 * DTO da inspeção, que é o que ficou registrado do veículo.
 */
export const createInspectionSchema = inspectionInputSchema.extend({
  confirmOdometerDecrease: z.boolean().default(false),
});

// --------------------------------- saída ---------------------------------

export const workOrderItemSchema = z.object({
  id: z.uuid(),
  type: z.enum(WORK_ORDER_ITEM_TYPES),
  serviceId: z.uuid().nullable(),
  partId: z.uuid().nullable(),
  description: z.string(),
  partCode: z.string().nullable(),
  brand: z.string().nullable(),
  quantity: z.number(),
  unitPriceCents: z.number().int(),
  /** null para quem não tem parts:view_cost */
  unitCostCents: z.number().int().nullable(),
  discountCents: z.number().int(),
  totalCents: z.number().int(),
  isOptional: z.boolean(),
  approvalStatus: z.enum(ITEM_APPROVAL_STATUSES),
  sourcing: z.enum(ITEM_SOURCINGS),
  stockStatus: z.enum(ITEM_STOCK_STATUSES),
  reservedQuantity: z.number(),
  /** disponível da peça agora (em estoque − reservado); null para item sem peça */
  availableQuantity: z.number().nullable(),
  mechanic: person.nullable(),
  estimatedMinutes: z.number().int().nullable(),
  position: z.number().int(),
});

export const workOrderTotalsSchema = z.object({
  partsSubtotalCents: z.number().int(),
  servicesSubtotalCents: z.number().int(),
  subtotalCents: z.number().int(),
  discountCents: z.number().int(),
  surchargeCents: z.number().int(),
  totalCents: z.number().int(),
  /** total do que o cliente já aprovou (E6) */
  approvedTotalCents: z.number().int(),
  paidCents: z.number().int(),
});

export const workOrderVehicleSchema = z.object({
  id: z.uuid(),
  plate: z.string().nullable(),
  make: z.string(),
  model: z.string(),
  version: z.string().nullable(),
  yearManufacture: z.number().int().nullable(),
  yearModel: z.number().int().nullable(),
  odometerKm: z.number().int().nullable(),
});

export const workOrderSchema = z.object({
  id: z.uuid(),
  number: z.number().int(),
  status: z.enum(WORK_ORDER_STATUSES),
  paymentStatus: z.enum(PAYMENT_STATUSES),
  customer: z.object({ id: z.uuid(), name: z.string(), whatsapp: z.string().nullable() }),
  vehicle: workOrderVehicleSchema,
  odometerKm: z.number().int().nullable(),
  complaint: z.string().nullable(),
  diagnosis: z.string().nullable(),
  customerNotes: z.string().nullable(),
  internalNotes: z.string().nullable(),
  advisor: person.nullable(),
  mechanic: person.nullable(),
  discountMode: z.enum(DISCOUNT_MODES).nullable(),
  discountValue: z.number().int(),
  warrantyDays: z.number().int().nullable(),
  warrantyKm: z.number().int().nullable(),
  promisedAt: z.string().nullable(),
  openedAt: z.string(),
  approvedAt: z.string().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  deliveredAt: z.string().nullable(),
  canceledAt: z.string().nullable(),
  cancelReason: z.string().nullable(),
  version: z.number().int(),
  totals: workOrderTotalsSchema,
  items: z.array(workOrderItemSchema),
  /**
   * O orçamento mais recente desta OS (docs/API.md: o GET da OS é o agregado
   * "OS + itens + orçamento atual + totais"). Evita a tela ter que caçar o
   * orçamento numa segunda chamada só para saber se há link esperando resposta.
   */
  currentQuote: z
    .object({
      id: z.uuid(),
      number: z.number().int(),
      status: z.string(),
      totalCents: z.number().int(),
      awaitingAnswer: z.boolean(),
    })
    .nullable(),
});

export const workOrderListItemSchema = z.object({
  id: z.uuid(),
  number: z.number().int(),
  status: z.enum(WORK_ORDER_STATUSES),
  paymentStatus: z.enum(PAYMENT_STATUSES),
  customerName: z.string(),
  vehiclePlate: z.string().nullable(),
  vehicleName: z.string(),
  mechanicName: z.string().nullable(),
  itemCount: z.number().int(),
  totalCents: z.number().int(),
  promisedAt: z.string().nullable(),
  openedAt: z.string(),
});

export const workOrderEventSchema = z.object({
  id: z.uuid(),
  type: z.enum(WORK_ORDER_EVENT_TYPES),
  data: z.record(z.string(), z.unknown()),
  actorType: z.enum(EVENT_ACTOR_TYPES),
  actorName: z.string().nullable(),
  createdAt: z.string(),
});

export const inspectionSchema = inspectionInputSchema.extend({
  id: z.uuid(),
  performedByName: z.string().nullable(),
  performedAt: z.string(),
});

/** Contagem por status, para o quadro da oficina. */
export const workOrderBoardSchema = z.object({
  counts: z.array(z.object({ status: z.enum(WORK_ORDER_STATUSES), count: z.number().int() })),
  activeTotal: z.number().int(),
});

export const attachmentSchema = z.object({
  id: z.uuid(),
  kind: z.enum(ATTACHMENT_KINDS),
  fileName: z.string().nullable(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  caption: z.string().nullable(),
  visibleToCustomer: z.boolean(),
  status: z.enum(ATTACHMENT_STATUSES),
  /** URL temporária de leitura; null enquanto o upload não terminou */
  url: z.string().nullable(),
  createdAt: z.string(),
});

// -------------------------------- uploads --------------------------------

/** No MVP 1: foto comprimida no aparelho e documento. Vídeo entra no MVP 2 (§11). */
export const UPLOAD_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;

export const createUploadSchema = z
  .object({
    kind: z.enum(['PHOTO', 'DOCUMENT']),
    mimeType: z.enum(UPLOAD_MIME_TYPES),
    sizeBytes: z.number().int().positive(),
    fileName: optionalText(200).default(''),
    /** a quem o arquivo pertence: pelo menos um */
    workOrderId: z.uuid().nullable().default(null),
    workOrderItemId: z.uuid().nullable().default(null),
    inspectionId: z.uuid().nullable().default(null),
    vehicleId: z.uuid().nullable().default(null),
    caption: optionalText(200).default(''),
    /** a página pública do orçamento (E6) só mostra o que está marcado aqui */
    visibleToCustomer: z.boolean().default(false),
  })
  .refine((v) => Boolean(v.workOrderId ?? v.inspectionId ?? v.vehicleId), {
    path: ['workOrderId'],
    message: 'Informe a OS ou o veículo do arquivo',
  });

/** O que o painel recebe para enviar o arquivo direto ao storage. */
export const uploadTicketSchema = z.object({
  attachment: attachmentSchema,
  uploadUrl: z.string(),
  expiresAt: z.string(),
});

export type CreateUploadInput = z.output<typeof createUploadSchema>;
export type UploadTicket = z.infer<typeof uploadTicketSchema>;
export type WorkOrderItemInput = z.input<typeof workOrderItemInputSchema>;
export type WorkOrderItem = z.infer<typeof workOrderItemSchema>;
export type CreateWorkOrderInput = z.output<typeof createWorkOrderSchema>;
export type UpdateWorkOrderInput = z.output<typeof updateWorkOrderSchema>;
export type WorkOrder = z.infer<typeof workOrderSchema>;
export type WorkOrderListItem = z.infer<typeof workOrderListItemSchema>;
export type WorkOrderTotals = z.infer<typeof workOrderTotalsSchema>;
export type WorkOrderEvent = z.infer<typeof workOrderEventSchema>;
export type InspectionInput = z.output<typeof inspectionInputSchema>;
export type CreateInspectionInput = z.output<typeof createInspectionSchema>;
export type Inspection = z.infer<typeof inspectionSchema>;
export type WorkOrderBoard = z.infer<typeof workOrderBoardSchema>;
export type Attachment = z.infer<typeof attachmentSchema>;
