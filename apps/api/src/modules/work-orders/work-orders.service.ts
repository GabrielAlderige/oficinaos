import {
  can,
  type CreateInspectionInput,
  type CreateWorkOrderInput,
  effectiveQuoteStatus,
  isQuoteAnswerable,
  discountCentsFor,
  effectiveServicePrice,
  ErrorCode,
  type Inspection,
  isDiscountWithinLimit,
  lineTotalCents,
  milliToDecimal,
  milliToNumber,
  nextStatus,
  type Page,
  parseQuantity,
  suggestedSalePrice,
  type UpdateWorkOrderInput,
  updateWorkOrderItemSchema,
  type WorkOrder,
  type WorkOrderAction,
  type WorkOrderEvent,
  type WorkOrderItem,
  type WorkOrderItemInput,
  type WorkOrderListItem,
  WORK_ORDER_STATUS_LABELS,
  WORK_ORDER_TRANSITIONS,
  type WorkOrderBoard,
  isEditable,
} from '@oficinaos/shared';
import type { z } from 'zod';
import { diffChanges, recordActivity } from '../../core/audit';
import { cancelWorkOrderEntries, ensureWorkOrderReceivable } from '../finance/finance.sync';
import { findRunningTimer, readItemTimes, startTimer, stopTimer } from './timers';
import type { AuthContext, ClientInfo, ServiceDeps } from '../../core/auth-context';
import { COUNTER_WORK_ORDER, nextNumber } from '../../core/counters';
import { AppError, notFound, validationFailed } from '../../core/errors';
import { blankToNull, isoOrNull } from '../../core/normalize';
import { assertOdometerNotDecreasing } from '../../core/odometer';
import { readOrganizationSettings } from '../../core/org-settings';
import { saldoCents, whatsappLink, whatsappVehicleReadyMessage } from '@oficinaos/shared';
import { consumeApprovedItems, releaseReservations, type ConsumptionSummary } from '../../core/reservations';
import { cancelOpenForWorkOrder as cancelOpenSupplierQuotes } from '../supplier-quotes/supplier-quotes.repository';
import { applyWorkOrderChange, pricingLinesOf } from './totals';
import type { workOrderItems, workOrders } from '../../db/schema';
import type { Tx } from '../../db/tenant';
import { withTenant } from '../../db/tenant';
import * as repo from './work-orders.repository';

type OrderPatch = Partial<typeof workOrders.$inferInsert>;
type ItemPatch = Partial<typeof workOrderItems.$inferInsert>;
type UpdateItemInput = z.output<typeof updateWorkOrderItemSchema>;
type ListQuery = {
  q?: string;
  status: Parameters<typeof repo.listWorkOrders>[2]['status'];
  mechanicId?: string;
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
};

/** numeric do banco ("4.500") → milésimos, e de volta. */
const milli = (value: string) => parseQuantity(value) ?? 0;
const toMilli = (value: number) => parseQuantity(value) ?? 0;

const canSeeCost = (auth: AuthContext) => can(auth.role, 'parts:view_cost');

function versionConflict() {
  return new AppError(
    409,
    ErrorCode.WORK_ORDER_VERSION_CONFLICT,
    'A OS mudou',
    'Outra pessoa salvou esta OS antes de você. Recarregue para ver o que mudou e tente de novo.',
  );
}

export class WorkOrdersService {
  constructor(private readonly deps: ServiceDeps) {}

  // ------------------------------------------------------------- leitura

  async list(auth: AuthContext, query: ListQuery): Promise<Page<WorkOrderListItem>> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const { rows, total } = await repo.listWorkOrders(tx, auth.organizationId, {
        q: query.q || undefined,
        status: query.status,
        mechanicId: query.mechanicId,
        from: query.from ? new Date(query.from) : undefined,
        to: query.to ? new Date(query.to) : undefined,
        limit: query.pageSize,
        offset: (query.page - 1) * query.pageSize,
      });
      const counts = await repo.countItems(
        tx,
        auth.organizationId,
        rows.map((row) => row.order.id),
      );
      const itemCount = new Map(counts.map((c) => [c.workOrderId, c.total]));
      return {
        data: rows.map((row) => ({
          id: row.order.id,
          number: row.order.number,
          status: row.order.status,
          paymentStatus: row.order.paymentStatus,
          customerName: row.customer.name,
          vehiclePlate: row.vehicle.plate,
          vehicleName: [row.vehicle.make, row.vehicle.model].filter(Boolean).join(' '),
          mechanicName: row.mechanicName,
          itemCount: itemCount.get(row.order.id) ?? 0,
          totalCents: row.order.totalCents,
          promisedAt: isoOrNull(row.order.promisedAt),
          openedAt: row.order.openedAt.toISOString(),
        })),
        meta: { page: query.page, pageSize: query.pageSize, total },
      };
    });
  }

  async board(auth: AuthContext): Promise<WorkOrderBoard> {
    const rows = await withTenant(this.deps.db, auth, (tx) => repo.countByStatus(tx, auth.organizationId));
    const counts = rows.map((row) => ({ status: row.status, count: row.total }));
    return {
      counts,
      activeTotal: counts
        .filter((c) => c.status !== 'DELIVERED' && c.status !== 'CANCELED')
        .reduce((total, c) => total + c.count, 0),
    };
  }

  async getByNumber(auth: AuthContext, number: number): Promise<WorkOrder> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const header = await repo.findWorkOrder(tx, auth.organizationId, { number });
      if (!header) throw notFound('OS não encontrada.');
      return this.toDto(tx, auth, header);
    });
  }

  async timeline(auth: AuthContext, id: string): Promise<WorkOrderEvent[]> {
    return withTenant(this.deps.db, auth, async (tx) => {
      await this.mustExist(tx, auth, id);
      const rows = await repo.listEvents(tx, auth.organizationId, id, 200);
      return rows.map((row) => ({
        id: row.id,
        type: row.type,
        data: row.data,
        actorType: row.actorType,
        actorName: row.actorName,
        createdAt: row.createdAt.toISOString(),
      }));
    });
  }

  async inspections(auth: AuthContext, id: string): Promise<Inspection[]> {
    return withTenant(this.deps.db, auth, async (tx) => {
      await this.mustExist(tx, auth, id);
      const rows = await repo.listInspections(tx, auth.organizationId, id);
      return rows.map(({ inspection, performedByName }) => ({
        id: inspection.id,
        type: inspection.type,
        odometerKm: inspection.odometerKm,
        fuelLevel: inspection.fuelLevel,
        checklist: inspection.checklist.map((entry) => ({ ...entry, note: entry.note ?? '' })),
        damages: inspection.damages.map((damage) => ({
          ...damage,
          note: damage.note ?? '',
          attachmentId: damage.attachmentId ?? null,
        })),
        accessories: inspection.accessories,
        notes: inspection.notes ?? '',
        performedByName,
        performedAt: inspection.performedAt.toISOString(),
      }));
    });
  }

  // ------------------------------------------------------------- escrita

  async create(auth: AuthContext, input: CreateWorkOrderInput, client: ClientInfo): Promise<WorkOrder> {
    return withTenant(this.deps.db, auth, (tx) => this.createInTx(tx, auth, input, client));
  }

  /**
   * O mesmo "abrir OS", só que dentro de uma transação que já existe. O
   * check-in da agenda (E8) precisa criar a OS e ligar o agendamento a ela sem
   * abrir uma segunda transação: ou as duas coisas acontecem, ou nenhuma.
   */
  async createInTx(
    tx: Tx,
    auth: AuthContext,
    input: CreateWorkOrderInput & { appointmentId?: string | null },
    client: ClientInfo,
  ): Promise<WorkOrder> {
    const vehicle = await repo.findVehicleWithCustomer(tx, auth.organizationId, input.vehicleId);
    if (!vehicle || vehicle.deletedAt) {
      throw validationFailed([{ path: 'body.vehicleId', message: 'Veículo não encontrado' }]);
    }
    if (vehicle.customerId !== input.customerId) {
      throw validationFailed([{ path: 'body.vehicleId', message: 'Este veículo é de outro cliente' }]);
    }

    const number = await nextNumber(tx, auth.organizationId, COUNTER_WORK_ORDER);
    const order = await repo.insertWorkOrder(tx, {
      organizationId: auth.organizationId,
      number,
      customerId: input.customerId,
      vehicleId: input.vehicleId,
      appointmentId: input.appointmentId ?? null,
      odometerKm: input.odometerKm,
      complaint: blankToNull(input.complaint),
      promisedAt: input.promisedAt ? new Date(input.promisedAt) : null,
      // quem abre é o consultor, salvo indicação em contrário
      advisorUserId: input.advisorUserId ?? auth.userId,
      mechanicUserId: input.mechanicUserId,
      createdBy: auth.userId,
    });

    for (const [index, item] of input.items.entries()) {
      await this.insertItem(tx, auth, order.id, item, index + 1);
    }
    const withTotals = await this.applyChange(tx, order);

    await repo.insertEvent(tx, {
      organizationId: auth.organizationId,
      workOrderId: order.id,
      type: 'CREATED',
      data: { number, itemCount: input.items.length },
      actorUserId: auth.userId,
    });
    await recordActivity(tx, {
      organizationId: auth.organizationId,
      actorUserId: auth.userId,
      action: 'work_order.created',
      entityType: 'work_order',
      entityId: order.id,
      metadata: { number, totalCents: withTotals.totalCents },
      ...client,
    });
    return this.load(tx, auth, order.id);
  }

  async update(auth: AuthContext, id: string, input: UpdateWorkOrderInput, client: ClientInfo): Promise<WorkOrder> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const order = await this.lockEditable(tx, auth, id, input.version);

      const patch: OrderPatch = {
        odometerKm: input.odometerKm,
        complaint: input.complaint === undefined ? undefined : blankToNull(input.complaint),
        diagnosis: input.diagnosis === undefined ? undefined : blankToNull(input.diagnosis),
        customerNotes: input.customerNotes === undefined ? undefined : blankToNull(input.customerNotes),
        internalNotes: input.internalNotes === undefined ? undefined : blankToNull(input.internalNotes),
        advisorUserId: input.advisorUserId,
        mechanicUserId: input.mechanicUserId,
        promisedAt: input.promisedAt === undefined ? undefined : input.promisedAt ? new Date(input.promisedAt) : null,
        discountMode: input.discountMode,
        discountValue: input.discountValue,
        surchargeCents: input.surchargeCents,
        warrantyDays: input.warrantyDays,
        warrantyKm: input.warrantyKm,
      };

      const touchesDiscount = input.discountMode !== undefined || input.discountValue !== undefined;
      if (touchesDiscount) await this.assertDiscountAllowed(tx, auth, order, patch);

      const changes = diffChanges(order, patch);
      const updated = await this.applyChange(tx, order, patch);
      if (Object.keys(changes).length) {
        await recordActivity(tx, {
          organizationId: auth.organizationId,
          actorUserId: auth.userId,
          action: 'work_order.updated',
          entityType: 'work_order',
          entityId: id,
          changes,
          metadata: { number: updated.number },
          ...client,
        });
      }
      return this.load(tx, auth, id);
    });
  }

  async addItem(auth: AuthContext, id: string, input: WorkOrderItemInput, client: ClientInfo): Promise<WorkOrder> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const order = await this.lockEditable(tx, auth, id);
      const position = await repo.nextItemPosition(tx, auth.organizationId, id);
      const item = await this.insertItem(tx, auth, id, input, position);
      await this.applyChange(tx, order);
      await this.itemsChanged(tx, auth, order, { added: item.description }, client);
      return this.load(tx, auth, id);
    });
  }

  async updateItem(
    auth: AuthContext,
    id: string,
    itemId: string,
    input: UpdateItemInput,
    client: ClientInfo,
  ): Promise<WorkOrder> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const order = await this.lockEditable(tx, auth, id);
      const item = await repo.findItem(tx, auth.organizationId, id, itemId);
      if (!item) throw notFound('Item não encontrado.');
      this.assertItemEditable(auth, item.approvalStatus);

      const patch: ItemPatch = {
        description: input.description === undefined ? undefined : input.description.trim() || item.description,
        quantity: input.quantity === undefined ? undefined : milliToDecimal(toMilli(input.quantity)),
        unitPriceCents: input.unitPriceCents,
        discountCents: input.discountCents,
        isOptional: input.isOptional,
        sourcing: input.sourcing,
        mechanicUserId: input.mechanicUserId,
        estimatedMinutes: input.estimatedMinutes,
      };
      const changes = diffChanges(item, patch);
      if (Object.keys(changes).length) {
        await repo.updateItem(tx, itemId, patch);
        await this.applyChange(tx, order);
        await this.itemsChanged(tx, auth, order, { changed: item.description }, client, changes);
      }
      return this.load(tx, auth, id);
    });
  }

  async removeItem(auth: AuthContext, id: string, itemId: string, client: ClientInfo): Promise<WorkOrder> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const order = await this.lockEditable(tx, auth, id);
      const item = await repo.findItem(tx, auth.organizationId, id, itemId);
      if (!item) throw notFound('Item não encontrado.');
      this.assertItemEditable(auth, item.approvalStatus);

      await repo.deleteItem(tx, itemId);
      await this.applyChange(tx, order);
      await this.itemsChanged(tx, auth, order, { removed: item.description }, client);
      return this.load(tx, auth, id);
    });
  }

  async reorderItems(auth: AuthContext, id: string, itemIds: string[], client: ClientInfo): Promise<WorkOrder> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const order = await this.lockEditable(tx, auth, id);
      for (const [index, itemId] of itemIds.entries()) {
        const item = await repo.findItem(tx, auth.organizationId, id, itemId);
        if (!item) throw validationFailed([{ path: 'body.itemIds', message: 'Item não encontrado nesta OS' }]);
        await repo.updateItem(tx, itemId, { position: index + 1 });
      }
      await this.applyChange(tx, order);
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'work_order.items_reordered',
        entityType: 'work_order',
        entityId: id,
        metadata: { number: order.number },
        ...client,
      });
      return this.load(tx, auth, id);
    });
  }

  /**
   * "Veículo pronto" pelo WhatsApp. A mensagem sai pronta e quem aperta enviar
   * é a pessoa da oficina — no V1 o canal é o link `wa.me`, sem API não
   * oficial. Fica no histórico de comunicação, como o envio do orçamento.
   *
   * O número é o do CLIENTE: o link abre a conversa com quem vai buscar o carro.
   */
  async vehicleReady(
    auth: AuthContext,
    id: string,
    client: ClientInfo,
  ): Promise<{ message: string; whatsappUrl: string | null }> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const found = await repo.findWorkOrder(tx, auth.organizationId, { id });
      if (!found) throw notFound('OS não encontrada.');

      const oficina = await repo.findOrganization(tx, auth.organizationId);
      const message = whatsappVehicleReadyMessage({
        customerName: found.customer.name,
        shopName: oficina?.name ?? 'Oficina',
        vehicle: { make: found.vehicle.make, model: found.vehicle.model, plate: found.vehicle.plate },
        balanceCents: saldoCents(found.order),
      });
      const whatsapp = found.customer.whatsapp ?? null;

      await repo.insertMessage(tx, {
        organizationId: auth.organizationId,
        customerId: found.customer.id,
        channel: 'WHATSAPP_LINK',
        direction: 'OUTBOUND',
        templateKey: 'VEHICLE_READY',
        body: message,
        toAddress: whatsapp,
        workOrderId: id,
        // o link wa.me não confirma entrega: é o que realmente sabemos
        status: 'LINK_OPENED',
        sentBy: auth.userId,
      });
      // entra na timeline, não só na auditoria: "o carro está pronto há dois
      // dias, alguém avisou?" é pergunta que se responde olhando o histórico
      await repo.insertEvent(tx, {
        organizationId: auth.organizationId,
        workOrderId: id,
        type: 'CUSTOMER_NOTIFIED',
        data: { canal: 'WHATSAPP_LINK', temWhatsapp: Boolean(whatsapp), balanceCents: saldoCents(found.order) },
        actorUserId: auth.userId,
      });
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'work_order.vehicle_ready',
        entityType: 'work_order',
        entityId: id,
        metadata: { number: found.order.number, balanceCents: saldoCents(found.order) },
        ...client,
      });

      return {
        message,
        // o telefone é gravado em E.164; quem monta o link é o shared, senão
        // sai `wa.me/55+55…` e o link não abre conversa nenhuma
        whatsappUrl: whatsapp ? whatsappLink(whatsapp, message) : null,
      };
    });
  }

  /** Ação de status: quem valida a transição é a máquina de estados do shared. */
  async runAction(
    auth: AuthContext,
    id: string,
    action: WorkOrderAction,
    input: { reason?: string },
    client: ClientInfo,
  ): Promise<WorkOrder> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const order = await repo.lockWorkOrder(tx, auth.organizationId, id);
      if (!order) throw notFound('OS não encontrada.');

      const to = nextStatus(order.status, action);
      if (!to) {
        throw new AppError(
          409,
          ErrorCode.INVALID_TRANSITION,
          'Ação indisponível agora',
          `A OS está "${WORK_ORDER_STATUS_LABELS[order.status]}": não é possível ${WORK_ORDER_TRANSITIONS[action].label.toLowerCase()}.`,
        );
      }

      const now = new Date();
      const patch: OrderPatch = { status: to };
      let baixa: ConsumptionSummary | null = null;
      if (action === 'start') patch.startedAt = order.startedAt ?? now;
      if (action === 'complete') {
        patch.completedAt = now;
        // a peça sai do estoque de verdade: a reserva vira saída (§10). Faltar
        // peça não trava — o saldo fica negativo e a oficina é avisada.
        baixa = await consumeApprovedItems(tx, auth.organizationId, id, auth.userId);
      }
      if (action === 'deliver') patch.deliveredAt = now;
      // reabrir NÃO estorna a baixa: a peça já está montada no carro
      if (action === 'reopen') patch.completedAt = null;
      if (action === 'cancel') {
        patch.canceledAt = now;
        patch.cancelReason = input.reason ?? null;
        // peça reservada volta para o estoque: o carro não vai mais ser feito (§10)
        const items = await repo.listItems(tx, auth.organizationId, id);
        await releaseReservations(tx, auth.organizationId, items.map(({ item }) => item.id));
        // e a cotação aberta com fornecedores morre junto: ninguém vai comprar
        // peça para um carro que não vai ser feito (lição do conserto b9d1a36)
        await cancelOpenSupplierQuotes(tx, auth.organizationId, id);
      }

      const updated = await this.applyChange(tx, order, patch);

      // financeiro (E13): a OS finalizada vira conta a receber; a cancelada
      // leva a conta junto, com motivo — cobrar um serviço que não houve é o
      // tipo de erro que a oficina só descobre discutindo com o cliente
      if (action === 'complete') {
        await ensureWorkOrderReceivable(tx, auth.organizationId, updated, auth.userId);
      }
      if (action === 'cancel') {
        await cancelWorkOrderEntries(tx, auth.organizationId, id, 'OS cancelada', auth.userId);
      }

      await repo.insertEvent(tx, {
        organizationId: auth.organizationId,
        workOrderId: id,
        type: action === 'cancel' ? 'CANCELED' : action === 'deliver' ? 'DELIVERED' : 'STATUS_CHANGED',
        data: {
          from: order.status,
          to,
          reason: input.reason ?? null,
          ...(baixa ? { consumidos: baixa.consumed, pecasNegativas: baixa.negative.length } : {}),
        },
        actorUserId: auth.userId,
      });
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: `work_order.${action.replace(/-/g, '_')}`,
        entityType: 'work_order',
        entityId: id,
        changes: { status: { from: order.status, to } },
        metadata: { number: updated.number, reason: input.reason ?? null },
        ...client,
      });
      return this.load(tx, auth, id);
    });
  }

  /**
   * Cronômetro do item de serviço (E15): o mecânico aperta "iniciar" quando põe
   * a mão no carro. Só UMA volta aberta por pessoa em toda a oficina — ninguém
   * trabalha em dois carros ao mesmo tempo, e sem isso o tempo real viraria
   * ficção. Começar em outro item para o anterior sozinho, que é o que a pessoa
   * quis dizer.
   */
  async startItemTimer(auth: AuthContext, id: string, itemId: string, client: ClientInfo): Promise<WorkOrder> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const order = await repo.lockWorkOrder(tx, auth.organizationId, id);
      if (!order) throw notFound('OS não encontrada.');
      if (order.status === 'CANCELED' || order.status === 'DELIVERED') {
        throw new AppError(
          422,
          ErrorCode.INVALID_TRANSITION,
          'OS encerrada',
          'Não dá para cronometrar uma OS entregue ou cancelada.',
        );
      }
      const item = await repo.findItem(tx, auth.organizationId, id, itemId);
      if (!item) throw notFound('Item não encontrado.');
      if (item.type !== 'SERVICE') {
        throw new AppError(422, ErrorCode.VALIDATION_FAILED, 'Item não é serviço', 'O cronômetro é do serviço, não da peça.');
      }

      const agora = new Date();
      const aberta = await findRunningTimer(tx, auth.organizationId, auth.userId);
      if (aberta) {
        if (aberta.workOrderItemId === itemId) return this.load(tx, auth, id);
        await stopTimer(tx, aberta.id, agora);
      }

      await startTimer(tx, {
        organizationId: auth.organizationId,
        workOrderId: id,
        workOrderItemId: itemId,
        mechanicUserId: auth.userId,
        startedAt: agora,
      });
      await repo.insertEvent(tx, {
        organizationId: auth.organizationId,
        workOrderId: id,
        type: 'NOTE',
        data: { cronometro: 'iniciado', item: item.description },
        actorUserId: auth.userId,
      });
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'work_order.timer_started',
        entityType: 'work_order_item',
        entityId: itemId,
        metadata: { number: order.number, item: item.description },
        ...client,
      });
      return this.load(tx, auth, id);
    });
  }

  /** Para a volta em andamento e soma os minutos ao item. */
  async stopItemTimer(auth: AuthContext, id: string, itemId: string, client: ClientInfo): Promise<WorkOrder> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const order = await repo.lockWorkOrder(tx, auth.organizationId, id);
      if (!order) throw notFound('OS não encontrada.');
      const aberta = await findRunningTimer(tx, auth.organizationId, auth.userId);
      if (!aberta || aberta.workOrderItemId !== itemId) {
        throw new AppError(
          422,
          ErrorCode.INVALID_TRANSITION,
          'Cronômetro parado',
          'Este serviço não está sendo cronometrado por você agora.',
        );
      }
      const fechada = await stopTimer(tx, aberta.id, new Date());
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'work_order.timer_stopped',
        entityType: 'work_order_item',
        entityId: itemId,
        metadata: { number: order.number, minutes: fechada.minutes },
        ...client,
      });
      return this.load(tx, auth, id);
    });
  }

  async addNote(auth: AuthContext, id: string, text: string, client: ClientInfo): Promise<WorkOrderEvent> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const order = await this.mustExist(tx, auth, id);
      const event = await repo.insertEvent(tx, {
        organizationId: auth.organizationId,
        workOrderId: id,
        type: 'NOTE',
        data: { text },
        actorUserId: auth.userId,
      });
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'work_order.note_added',
        entityType: 'work_order',
        entityId: id,
        metadata: { number: order.order.number },
        ...client,
      });
      return {
        id: event.id,
        type: event.type,
        data: event.data,
        actorType: event.actorType,
        actorName: null,
        createdAt: event.createdAt.toISOString(),
      };
    });
  }

  /** Check-in e check-out: o que o carro era quando entrou, para não sobrar discussão. */
  async createInspection(
    auth: AuthContext,
    id: string,
    input: CreateInspectionInput,
    client: ClientInfo,
  ): Promise<Inspection> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const order = await this.lockEditable(tx, auth, id);

      // o km do check-in é o km do carro: vale a mesma regra do cadastro (E3)
      if (input.odometerKm !== null) {
        const vehicle = await repo.lockVehicleOdometer(tx, auth.organizationId, order.vehicleId);
        assertOdometerNotDecreasing({
          previousKm: vehicle?.odometerKm ?? null,
          nextKm: input.odometerKm,
          confirmed: input.confirmOdometerDecrease,
          field: 'body.odometerKm',
        });
      }

      const row = await repo.insertInspection(tx, {
        organizationId: auth.organizationId,
        workOrderId: id,
        vehicleId: order.vehicleId,
        type: input.type,
        odometerKm: input.odometerKm,
        fuelLevel: input.fuelLevel,
        checklist: input.checklist,
        damages: input.damages,
        accessories: input.accessories,
        notes: blankToNull(input.notes),
        performedBy: auth.userId,
      });
      if (input.odometerKm !== null) {
        await this.applyChange(tx, order, { odometerKm: input.odometerKm });
        await repo.updateVehicleOdometer(tx, order.vehicleId, input.odometerKm);
        await repo.insertOdometerReading(tx, {
          organizationId: auth.organizationId,
          vehicleId: order.vehicleId,
          km: input.odometerKm,
          source: input.type === 'CHECK_IN' ? 'CHECK_IN' : 'WORK_ORDER',
          workOrderId: id,
          recordedBy: auth.userId,
        });
      }

      await repo.insertEvent(tx, {
        organizationId: auth.organizationId,
        workOrderId: id,
        type: input.type,
        data: {
          odometerKm: input.odometerKm,
          issues: input.checklist.filter((entry) => entry.state === 'ISSUE').length,
          damages: input.damages.length,
        },
        actorUserId: auth.userId,
      });
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: `work_order.${input.type.toLowerCase()}`,
        entityType: 'work_order',
        entityId: id,
        metadata: { number: order.number, odometerKm: input.odometerKm },
        ...client,
      });

      return {
        id: row.id,
        type: row.type,
        odometerKm: row.odometerKm,
        fuelLevel: row.fuelLevel,
        checklist: input.checklist,
        damages: input.damages,
        accessories: input.accessories,
        notes: row.notes ?? '',
        performedByName: null,
        performedAt: row.performedAt.toISOString(),
      };
    });
  }

  // ------------------------------------------------------------ internos

  private async mustExist(tx: Tx, auth: AuthContext, id: string) {
    const header = await repo.findWorkOrder(tx, auth.organizationId, { id });
    if (!header) throw notFound('OS não encontrada.');
    return header;
  }

  /** Trava a OS, confere se ainda aceita mudança e (quando enviada) a versão. */
  private async lockEditable(tx: Tx, auth: AuthContext, id: string, version?: number) {
    const order = await repo.lockWorkOrder(tx, auth.organizationId, id);
    if (!order) throw notFound('OS não encontrada.');
    if (!isEditable(order.status)) {
      throw new AppError(
        409,
        ErrorCode.WORK_ORDER_NOT_EDITABLE,
        'OS encerrada',
        `Esta OS está "${WORK_ORDER_STATUS_LABELS[order.status]}" e não aceita mais alterações.`,
      );
    }
    if (version !== undefined && version !== order.version) throw versionConflict();
    return order;
  }

  private assertItemEditable(auth: AuthContext, approvalStatus: string) {
    if (approvalStatus === 'APPROVED' && !can(auth.role, 'work_orders:edit_approved')) {
      throw new AppError(
        403,
        ErrorCode.ITEM_ALREADY_APPROVED,
        'Item já aprovado',
        'O cliente já aprovou este item. Peça a um gerente para alterar.',
      );
    }
  }

  /** Desconto exige permissão e, sem "ilimitado", respeita o limite da oficina. */
  private async assertDiscountAllowed(tx: Tx, auth: AuthContext, order: repo.WorkOrderRow, patch: OrderPatch) {
    if (!can(auth.role, 'work_orders:discount')) {
      throw new AppError(403, ErrorCode.FORBIDDEN, 'Sem permissão', 'Seu acesso não permite aplicar desconto.');
    }
    if (can(auth.role, 'work_orders:discount_unlimited')) return;

    const settings = await readOrganizationSettings(tx, auth.organizationId);
    const lines = await pricingLinesOf(tx, order);
    const subtotal = lines.reduce((total, line) => total + lineTotalCents(line), 0);
    const mode = patch.discountMode === undefined ? order.discountMode : patch.discountMode;
    const value = patch.discountValue === undefined ? order.discountValue : patch.discountValue;
    const discount = discountCentsFor(subtotal, mode, value);
    if (!isDiscountWithinLimit(subtotal, discount, settings.discountLimitBps)) {
      throw new AppError(
        403,
        ErrorCode.DISCOUNT_ABOVE_LIMIT,
        'Desconto acima do seu limite',
        `Seu limite é ${settings.discountLimitBps / 100}% do subtotal. Peça a um gerente.`,
        [{ path: 'body.discountValue', message: 'Acima do limite do seu papel' }],
      );
    }
  }

  /** O recálculo mora em `./totals`: o orçamento (E6) mexe nos mesmos números. */
  private applyChange(tx: Tx, order: repo.WorkOrderRow, patch: OrderPatch = {}): Promise<repo.WorkOrderRow> {
    return applyWorkOrderChange(tx, order, patch);
  }

  /** Preço e descrição do item: o catálogo manda, e a pessoa pode sobrescrever. */
  private async insertItem(
    tx: Tx,
    auth: AuthContext,
    workOrderId: string,
    input: WorkOrderItemInput,
    position: number,
  ) {
    const parsed = {
      type: input.type,
      serviceId: input.serviceId ?? null,
      partId: input.partId ?? null,
      description: (input.description ?? '').trim(),
      quantity: input.quantity ?? 1,
      unitPriceCents: input.unitPriceCents ?? null,
      discountCents: input.discountCents ?? 0,
      isOptional: input.isOptional ?? false,
      sourcing: input.sourcing ?? 'STOCK',
      mechanicUserId: input.mechanicUserId ?? null,
      estimatedMinutes: input.estimatedMinutes ?? null,
    };
    if (parsed.type === 'SERVICE' && parsed.partId) {
      throw validationFailed([{ path: 'body.partId', message: 'Item de serviço não leva peça' }]);
    }
    if (parsed.type === 'PART' && parsed.serviceId) {
      throw validationFailed([{ path: 'body.serviceId', message: 'Item de peça não leva serviço' }]);
    }

    const settings = await readOrganizationSettings(tx, auth.organizationId);
    let description = parsed.description;
    let unitPriceCents = parsed.unitPriceCents;
    let unitCostCents: number | null = null;
    let partCode: string | null = null;
    let brand: string | null = null;
    let estimatedMinutes = parsed.estimatedMinutes;

    if (parsed.serviceId) {
      const service = await repo.findServiceForItem(tx, auth.organizationId, parsed.serviceId);
      if (!service || service.deletedAt) {
        throw validationFailed([{ path: 'body.serviceId', message: 'Serviço não encontrado' }]);
      }
      description ||= service.name;
      estimatedMinutes ??= service.estimatedMinutes;
      unitPriceCents ??= effectiveServicePrice(service, settings.laborRateCents);
      if (unitPriceCents === null) {
        throw validationFailed([
          { path: 'body.unitPriceCents', message: 'Informe o preço: a hora técnica da oficina não está configurada' },
        ]);
      }
    } else if (parsed.partId) {
      const part = await repo.findPartForItem(tx, auth.organizationId, parsed.partId);
      if (!part || part.deletedAt) throw validationFailed([{ path: 'body.partId', message: 'Peça não encontrada' }]);
      const cost = part.averageCostCents ?? part.lastCostCents;
      description ||= part.name;
      partCode = part.manufacturerCode ?? part.sku;
      brand = part.manufacturer;
      unitCostCents = cost;
      unitPriceCents ??=
        part.salePriceCents ?? (cost !== null ? suggestedSalePrice(cost, part.markupBps ?? settings.defaultMarkupBps) : null);
      if (unitPriceCents === null) {
        throw validationFailed([{ path: 'body.unitPriceCents', message: 'Informe o preço: a peça não tem preço de venda' }]);
      }
    } else if (unitPriceCents === null) {
      throw validationFailed([{ path: 'body.unitPriceCents', message: 'Informe o preço' }]);
    }

    const quantityMilli = toMilli(parsed.quantity);
    const item = await repo.insertItem(tx, {
      organizationId: auth.organizationId,
      workOrderId,
      type: parsed.type,
      serviceId: parsed.serviceId,
      partId: parsed.partId,
      description,
      partCode,
      brand,
      quantity: milliToDecimal(quantityMilli),
      unitPriceCents,
      unitCostCents,
      discountCents: parsed.discountCents,
      totalCents: lineTotalCents({
        type: parsed.type,
        quantityMilli,
        unitPriceCents,
        discountCents: parsed.discountCents,
      }),
      isOptional: parsed.isOptional,
      sourcing: parsed.sourcing,
      mechanicUserId: parsed.mechanicUserId,
      estimatedMinutes,
      position,
    });
    return item;
  }

  private async itemsChanged(
    tx: Tx,
    auth: AuthContext,
    order: repo.WorkOrderRow,
    data: Record<string, unknown>,
    client: ClientInfo,
    changes?: Record<string, unknown>,
  ) {
    await repo.insertEvent(tx, {
      organizationId: auth.organizationId,
      workOrderId: order.id,
      type: 'ITEMS_CHANGED',
      data,
      actorUserId: auth.userId,
    });
    await recordActivity(tx, {
      organizationId: auth.organizationId,
      actorUserId: auth.userId,
      action: 'work_order.items_changed',
      entityType: 'work_order',
      entityId: order.id,
      changes: changes as never,
      metadata: { number: order.number, ...data },
      ...client,
    });
  }

  private async load(tx: Tx, auth: AuthContext, id: string): Promise<WorkOrder> {
    return this.toDto(tx, auth, await this.mustExist(tx, auth, id));
  }

  private async toDto(tx: Tx, auth: AuthContext, header: repo.WorkOrderHeader): Promise<WorkOrder> {
    const order = header.order;
    const quote = await repo.findCurrentQuote(tx, auth.organizationId, order.id);
    const rows = await repo.listItems(tx, auth.organizationId, order.id);
    const showCost = canSeeCost(auth);
    // tempo real do cronômetro (E15): uma consulta para todos os itens da OS
    const tempos = await readItemTimes(tx, auth.organizationId, rows.map(({ item }) => item.id));
    const items: WorkOrderItem[] = rows.map(({ item, mechanicName, partOnHand, partReserved }) => ({
      id: item.id,
      type: item.type,
      serviceId: item.serviceId,
      partId: item.partId,
      description: item.description,
      partCode: item.partCode,
      brand: item.brand,
      quantity: milliToNumber(milli(item.quantity)),
      unitPriceCents: item.unitPriceCents,
      unitCostCents: showCost ? item.unitCostCents : null,
      discountCents: item.discountCents,
      totalCents: item.totalCents,
      isOptional: item.isOptional,
      approvalStatus: item.approvalStatus,
      sourcing: item.sourcing,
      stockStatus: item.stockStatus,
      reservedQuantity: milliToNumber(milli(item.reservedQuantity)),
      availableQuantity:
        partOnHand === null || partReserved === null ? null : milliToNumber(milli(partOnHand) - milli(partReserved)),
      mechanic: item.mechanicUserId && mechanicName ? { id: item.mechanicUserId, name: mechanicName } : null,
      estimatedMinutes: item.estimatedMinutes,
      actualMinutes: tempos.get(item.id)?.minutes ?? 0,
      timerStartedAt: tempos.get(item.id)?.runningSince ?? null,
      timerMechanicName: tempos.get(item.id)?.runningMechanicName ?? null,
      position: item.position,
    }));

    return {
      id: order.id,
      number: order.number,
      status: order.status,
      paymentStatus: order.paymentStatus,
      customer: {
        id: header.customer.id,
        name: header.customer.name,
        whatsapp: header.customer.whatsapp ?? header.customer.phone,
      },
      vehicle: { ...header.vehicle },
      odometerKm: order.odometerKm,
      complaint: order.complaint,
      diagnosis: order.diagnosis,
      customerNotes: order.customerNotes,
      internalNotes: order.internalNotes,
      advisor: order.advisorUserId && header.advisorName ? { id: order.advisorUserId, name: header.advisorName } : null,
      mechanic:
        order.mechanicUserId && header.mechanicName ? { id: order.mechanicUserId, name: header.mechanicName } : null,
      discountMode: order.discountMode,
      discountValue: order.discountValue,
      warrantyDays: order.warrantyDays,
      warrantyKm: order.warrantyKm,
      promisedAt: isoOrNull(order.promisedAt),
      openedAt: order.openedAt.toISOString(),
      approvedAt: isoOrNull(order.approvedAt),
      startedAt: isoOrNull(order.startedAt),
      completedAt: isoOrNull(order.completedAt),
      deliveredAt: isoOrNull(order.deliveredAt),
      canceledAt: isoOrNull(order.canceledAt),
      cancelReason: order.cancelReason,
      version: order.version,
      totals: {
        partsSubtotalCents: order.partsSubtotalCents,
        servicesSubtotalCents: order.servicesSubtotalCents,
        subtotalCents: order.partsSubtotalCents + order.servicesSubtotalCents,
        discountCents: order.discountCents,
        surchargeCents: order.surchargeCents,
        totalCents: order.totalCents,
        approvedTotalCents: order.approvedTotalCents,
        paidCents: order.paidCents,
      },
      items,
      currentQuote: quote
        ? {
            id: quote.id,
            number: quote.number,
            status: effectiveQuoteStatus(quote.status, quote.validUntil.toISOString()),
            totalCents: quote.totalCents,
            // "esperando o cliente": é o que decide se a tela mostra o link
            awaitingAnswer: isQuoteAnswerable(quote.status, quote.validUntil.toISOString()),
          }
        : null,
    };
  }
}
