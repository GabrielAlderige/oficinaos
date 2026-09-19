import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  ATTACHMENT_KINDS,
  ATTACHMENT_STATUSES,
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
  type ChecklistState,
  type DamageKind,
  type DamageZone,
} from '@oficinaos/shared';
import { id, timestamps, timestamptz } from './_columns';
import { parts, services } from './catalog';
import { customers, vehicles } from './customers';
import { organizations, users } from './tenancy';

const list = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(','));

const quantity = () => numeric({ precision: 12, scale: 3 });
const money = () => bigint({ mode: 'number' });

export interface ChecklistEntry {
  key: string;
  label: string;
  state: ChecklistState;
  note?: string;
}

export interface Damage {
  zone: DamageZone;
  kind: DamageKind;
  note?: string;
  attachmentId?: string | null;
}

/**
 * Ordem de serviço (docs/DATABASE.md §5.5). Os totais são CACHE recalculado pelo
 * domínio (`packages/shared/pricing.ts`) a cada mudança de item; `version` é lock
 * otimista, porque atendente e mecânico editam a mesma OS ao mesmo tempo.
 * `number` é a numeração humana ("OS 182"), tirada de `organization_counters`.
 */
export const workOrders = pgTable(
  'work_orders',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    number: integer().notNull(),
    /**
     * "Acompanhe seu veículo" (E17): o link que o cliente abre para ver em que
     * pé está o carro. Nasce só quando a oficina manda o link — OS que ninguém
     * acompanhou não tem token à toa.
     */
    trackingToken: text().unique(),
    customerId: uuid().notNull(),
    vehicleId: uuid().notNull(),
    /**
     * Preenchido no check-in do agendamento (E8). A FK composta com
     * `appointments` é criada na migration da agenda, e não aqui: declará-la no
     * schema faria os dois arquivos se importarem em círculo.
     */
    appointmentId: uuid(),
    status: text({ enum: WORK_ORDER_STATUSES }).notNull().default('OPEN'),
    /** independente do status: entregar com saldo em aberto é permitido */
    paymentStatus: text({ enum: PAYMENT_STATUSES }).notNull().default('UNPAID'),
    odometerKm: integer(),
    complaint: text(),
    diagnosis: text(),
    customerNotes: text(),
    internalNotes: text(),
    advisorUserId: uuid().references(() => users.id),
    mechanicUserId: uuid().references(() => users.id),
    partsSubtotalCents: money().notNull().default(0),
    servicesSubtotalCents: money().notNull().default(0),
    discountMode: text({ enum: DISCOUNT_MODES }),
    /** centavos quando AMOUNT, basis points quando PERCENT */
    discountValue: money().notNull().default(0),
    discountCents: money().notNull().default(0),
    surchargeCents: money().notNull().default(0),
    totalCents: money().notNull().default(0),
    approvedTotalCents: money().notNull().default(0),
    paidCents: money().notNull().default(0),
    promisedAt: timestamptz(),
    warrantyDays: integer(),
    warrantyKm: integer(),
    openedAt: timestamptz().notNull().defaultNow(),
    approvedAt: timestamptz(),
    startedAt: timestamptz(),
    completedAt: timestamptz(),
    deliveredAt: timestamptz(),
    canceledAt: timestamptz(),
    cancelReason: text(),
    version: integer().notNull().default(1),
    createdBy: uuid().references(() => users.id),
    ...timestamps,
  },
  (t) => [
    unique('work_orders_org_id_unique').on(t.organizationId, t.id),
    unique('work_orders_org_number_unique').on(t.organizationId, t.number),
    foreignKey({
      name: 'work_orders_customer_fk',
      columns: [t.organizationId, t.customerId],
      foreignColumns: [customers.organizationId, customers.id],
    }),
    foreignKey({
      name: 'work_orders_vehicle_fk',
      columns: [t.organizationId, t.vehicleId],
      foreignColumns: [vehicles.organizationId, vehicles.id],
    }),
    index('work_orders_org_status_idx').on(t.organizationId, t.status, t.openedAt.desc()),
    index('work_orders_org_vehicle_idx').on(t.organizationId, t.vehicleId, t.openedAt.desc()),
    index('work_orders_org_customer_idx').on(t.organizationId, t.customerId, t.openedAt.desc()),
    check('work_orders_status_check', sql`${t.status} in (${list(WORK_ORDER_STATUSES)})`),
    check('work_orders_payment_status_check', sql`${t.paymentStatus} in (${list(PAYMENT_STATUSES)})`),
    check('work_orders_discount_mode_check', sql`${t.discountMode} is null or ${t.discountMode} in (${list(DISCOUNT_MODES)})`),
    check('work_orders_number_check', sql`${t.number} > 0`),
    check('work_orders_odometer_check', sql`${t.odometerKm} is null or ${t.odometerKm} >= 0`),
    check(
      'work_orders_money_check',
      sql`${t.discountValue} >= 0 and ${t.discountCents} >= 0 and ${t.surchargeCents} >= 0 and ${t.totalCents} >= 0 and ${t.paidCents} >= 0`,
    ),
    check('work_orders_cancel_reason_check', sql`${t.canceledAt} is null or ${t.cancelReason} is not null`),
  ],
);

/**
 * Item da OS. `description`, `part_code` e `brand` são SNAPSHOT do catálogo no
 * momento: mudar o nome da peça depois não reescreve a OS de ontem.
 */
export const workOrderItems = pgTable(
  'work_order_items',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    workOrderId: uuid().notNull(),
    type: text({ enum: WORK_ORDER_ITEM_TYPES }).notNull(),
    /** null nos dois = item avulso (peça comprada fora, serviço sem cadastro) */
    serviceId: uuid(),
    partId: uuid(),
    description: text().notNull(),
    partCode: text(),
    brand: text(),
    quantity: quantity().notNull().default('1'),
    unitPriceCents: money().notNull(),
    /** custo para a margem; oculto sem parts:view_cost */
    unitCostCents: money(),
    discountCents: money().notNull().default(0),
    totalCents: money().notNull().default(0),
    /** "recomendado": o cliente pode desmarcar na página pública (E6) */
    isOptional: boolean().notNull().default(false),
    approvalStatus: text({ enum: ITEM_APPROVAL_STATUSES }).notNull().default('DRAFT'),
    sourcing: text({ enum: ITEM_SOURCINGS }).notNull().default('STOCK'),
    stockStatus: text({ enum: ITEM_STOCK_STATUSES }).notNull().default('NONE'),
    reservedQuantity: quantity().notNull().default('0'),
    mechanicUserId: uuid().references(() => users.id),
    estimatedMinutes: integer(),
    /** tempo real: MVP 2 */
    actualMinutes: integer(),
    position: integer().notNull().default(0),
    ...timestamps,
  },
  (t) => [
    unique('work_order_items_org_id_unique').on(t.organizationId, t.id),
    foreignKey({
      name: 'work_order_items_work_order_fk',
      columns: [t.organizationId, t.workOrderId],
      foreignColumns: [workOrders.organizationId, workOrders.id],
    }),
    foreignKey({
      name: 'work_order_items_service_fk',
      columns: [t.organizationId, t.serviceId],
      foreignColumns: [services.organizationId, services.id],
    }),
    foreignKey({
      name: 'work_order_items_part_fk',
      columns: [t.organizationId, t.partId],
      foreignColumns: [parts.organizationId, parts.id],
    }),
    index('work_order_items_order_idx').on(t.organizationId, t.workOrderId, t.position),
    check('work_order_items_type_check', sql`${t.type} in (${list(WORK_ORDER_ITEM_TYPES)})`),
    check('work_order_items_approval_check', sql`${t.approvalStatus} in (${list(ITEM_APPROVAL_STATUSES)})`),
    check('work_order_items_sourcing_check', sql`${t.sourcing} in (${list(ITEM_SOURCINGS)})`),
    check('work_order_items_stock_status_check', sql`${t.stockStatus} in (${list(ITEM_STOCK_STATUSES)})`),
    check('work_order_items_quantity_check', sql`${t.quantity} > 0 and ${t.reservedQuantity} >= 0`),
    check(
      'work_order_items_money_check',
      sql`${t.unitPriceCents} >= 0 and ${t.discountCents} >= 0 and ${t.totalCents} >= 0`,
    ),
    /** item de serviço não sai do estoque; item de peça é que reserva */
    check(
      'work_order_items_service_has_no_part_check',
      sql`(${t.type} = 'SERVICE' and ${t.partId} is null) or (${t.type} = 'PART' and ${t.serviceId} is null)`,
    ),
  ],
);

/**
 * Timeline da OS, voltada a pessoas (a auditoria técnica é `activity_logs`).
 * Append-only: evento não se edita nem se apaga.
 */
export const workOrderEvents = pgTable(
  'work_order_events',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    workOrderId: uuid().notNull(),
    type: text({ enum: WORK_ORDER_EVENT_TYPES }).notNull(),
    data: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    actorType: text({ enum: EVENT_ACTOR_TYPES }).notNull().default('USER'),
    actorUserId: uuid().references(() => users.id),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'work_order_events_work_order_fk',
      columns: [t.organizationId, t.workOrderId],
      foreignColumns: [workOrders.organizationId, workOrders.id],
    }),
    index('work_order_events_order_idx').on(t.organizationId, t.workOrderId, t.createdAt),
    check('work_order_events_type_check', sql`${t.type} in (${list(WORK_ORDER_EVENT_TYPES)})`),
    check('work_order_events_actor_check', sql`${t.actorType} in (${list(EVENT_ACTOR_TYPES)})`),
  ],
);

/**
 * Check-in e check-out do veículo. Checklist, avarias e acessórios são `jsonb`
 * de propósito: o modelo varia por oficina e é sempre lido e gravado inteiro
 * (docs/DATABASE.md §5.5).
 */
export const vehicleInspections = pgTable(
  'vehicle_inspections',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    workOrderId: uuid().notNull(),
    vehicleId: uuid().notNull(),
    type: text({ enum: INSPECTION_TYPES }).notNull(),
    odometerKm: integer(),
    /** oitavos, como o ponteiro do painel */
    fuelLevel: smallint(),
    checklist: jsonb().$type<ChecklistEntry[]>().notNull().default([]),
    damages: jsonb().$type<Damage[]>().notNull().default([]),
    accessories: jsonb().$type<string[]>().notNull().default([]),
    notes: text(),
    /** assinatura na tela: MVP 2 */
    customerAcknowledgedAt: timestamptz(),
    signatureAttachmentId: uuid(),
    performedBy: uuid().references(() => users.id),
    performedAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    unique('vehicle_inspections_org_id_unique').on(t.organizationId, t.id),
    foreignKey({
      name: 'vehicle_inspections_work_order_fk',
      columns: [t.organizationId, t.workOrderId],
      foreignColumns: [workOrders.organizationId, workOrders.id],
    }),
    foreignKey({
      name: 'vehicle_inspections_vehicle_fk',
      columns: [t.organizationId, t.vehicleId],
      foreignColumns: [vehicles.organizationId, vehicles.id],
    }),
    index('vehicle_inspections_order_idx').on(t.organizationId, t.workOrderId, t.performedAt),
    check('vehicle_inspections_type_check', sql`${t.type} in (${list(INSPECTION_TYPES)})`),
    check('vehicle_inspections_fuel_check', sql`${t.fuelLevel} is null or ${t.fuelLevel} between 0 and 8`),
    check('vehicle_inspections_odometer_check', sql`${t.odometerKm} is null or ${t.odometerKm} >= 0`),
  ],
);

/**
 * Foto, vídeo ou documento. FKs explícitas em vez de polimórfica: o banco
 * garante a integridade (docs/DATABASE.md §5.5). O arquivo em si vive no
 * storage; aqui fica a `storage_key` e o estado do upload.
 */
export const attachments = pgTable(
  'attachments',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    workOrderId: uuid(),
    workOrderItemId: uuid(),
    inspectionId: uuid(),
    vehicleId: uuid(),
    kind: text({ enum: ATTACHMENT_KINDS }).notNull().default('PHOTO'),
    storageKey: text().notNull(),
    fileName: text(),
    mimeType: text().notNull(),
    sizeBytes: bigint({ mode: 'number' }).notNull(),
    width: integer(),
    height: integer(),
    caption: text(),
    /** a página pública do orçamento (E6) só mostra o que está marcado aqui */
    visibleToCustomer: boolean().notNull().default(false),
    status: text({ enum: ATTACHMENT_STATUSES }).notNull().default('PENDING_UPLOAD'),
    uploadedBy: uuid().references(() => users.id),
    deletedAt: timestamptz(),
    ...timestamps,
  },
  (t) => [
    unique('attachments_org_id_unique').on(t.organizationId, t.id),
    foreignKey({
      name: 'attachments_work_order_fk',
      columns: [t.organizationId, t.workOrderId],
      foreignColumns: [workOrders.organizationId, workOrders.id],
    }),
    foreignKey({
      name: 'attachments_work_order_item_fk',
      columns: [t.organizationId, t.workOrderItemId],
      foreignColumns: [workOrderItems.organizationId, workOrderItems.id],
    }),
    foreignKey({
      name: 'attachments_inspection_fk',
      columns: [t.organizationId, t.inspectionId],
      foreignColumns: [vehicleInspections.organizationId, vehicleInspections.id],
    }),
    foreignKey({
      name: 'attachments_vehicle_fk',
      columns: [t.organizationId, t.vehicleId],
      foreignColumns: [vehicles.organizationId, vehicles.id],
    }),
    index('attachments_org_work_order_idx').on(t.organizationId, t.workOrderId),
    check('attachments_kind_check', sql`${t.kind} in (${list(ATTACHMENT_KINDS)})`),
    check('attachments_status_check', sql`${t.status} in (${list(ATTACHMENT_STATUSES)})`),
    check('attachments_size_check', sql`${t.sizeBytes} > 0`),
    /** todo anexo pertence a alguma coisa */
    check(
      'attachments_parent_check',
      sql`${t.workOrderId} is not null or ${t.inspectionId} is not null or ${t.vehicleId} is not null`,
    ),
  ],
);
