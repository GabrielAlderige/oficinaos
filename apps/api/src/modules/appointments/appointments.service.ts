import {
  APPOINTMENT_TRANSITIONS,
  canTransitionAppointment,
  dayKey,
  ErrorCode,
  findConflicts,
  formatMinutes,
  formatWhen,
  isReschedulable,
  minutesOfDay,
  whatsappAppointmentMessage,
  whatsappLink,
  type Appointment,
  type AppointmentAction,
  type AppointmentCheckInInput,
  type AppointmentConflict,
  type AppointmentListQuery,
  type CancelAppointmentInput,
  type ConflictQuery,
  type CreateAppointmentInput,
  type RescheduleAppointmentInput,
  type ScheduledSlot,
  type WorkOrder,
} from '@oficinaos/shared';
import { recordActivity } from '../../core/audit';
import { readTimezone } from '../../core/org-settings';
import type { AuthContext, ClientInfo, ServiceDeps } from '../../core/auth-context';
import { AppError, notFound, validationFailed, type FieldError } from '../../core/errors';
import { blankToNull, isoOrNull } from '../../core/normalize';
import type { Tx } from '../../db/tenant';
import { withTenant } from '../../db/tenant';
import * as customerRepo from '../customers/customers.repository';
import * as workOrderRepo from '../work-orders/work-orders.repository';
import type { WorkOrdersService } from '../work-orders/work-orders.service';
import * as repo from './appointments.repository';

const toDto = (row: repo.AppointmentDetail): Appointment => {
  const a = row.appointment;
  return {
    id: a.id,
    customerId: a.customerId,
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    customerWhatsapp: row.customerWhatsapp,
    vehicleId: a.vehicleId,
    vehicleLabel: row.vehicleMake ? `${row.vehicleMake} ${row.vehicleModel}` : null,
    vehiclePlate: row.vehiclePlate,
    mechanicUserId: a.mechanicUserId,
    mechanicName: row.mechanicName,
    mechanicColor: row.mechanicColor,
    serviceId: a.serviceId,
    serviceName: row.serviceName,
    title: a.title,
    startsAt: a.startsAt.toISOString(),
    endsAt: a.endsAt.toISOString(),
    status: a.status,
    notes: a.notes,
    workOrderId: a.workOrderId,
    workOrderNumber: row.workOrderNumber,
    confirmedAt: isoOrNull(a.confirmedAt),
    canceledAt: isoOrNull(a.canceledAt),
    cancelReason: a.cancelReason,
    createdAt: a.createdAt.toISOString(),
  };
};

const toConflict = (row: repo.AppointmentDetail): AppointmentConflict => ({
  id: row.appointment.id,
  title: row.appointment.title,
  startsAt: row.appointment.startsAt.toISOString(),
  endsAt: row.appointment.endsAt.toISOString(),
  status: row.appointment.status,
  customerName: row.customerName,
  mechanicName: row.mechanicName,
});

const toSlot = (row: repo.AppointmentDetail): ScheduledSlot => ({
  id: row.appointment.id,
  status: row.appointment.status,
  mechanicUserId: row.appointment.mechanicUserId,
  startsAt: row.appointment.startsAt,
  endsAt: row.appointment.endsAt,
});

/** "14/09, das 09:00 às 10:00" — escrito no relógio da oficina, não no do servidor. */
function faixaTexto(startsAt: Date, endsAt: Date, timeZone: string): string {
  const [, mes, dia] = dayKey(startsAt, timeZone).split('-');
  const inicio = formatMinutes(minutesOfDay(startsAt, timeZone));
  const fim = formatMinutes(minutesOfDay(endsAt, timeZone));
  return `${dia}/${mes}, das ${inicio} às ${fim}`;
}

/**
 * Agenda (docs/DATABASE.md §5.4). Duas regras mandam neste módulo:
 *
 * 1. **Conflito avisa, não impede.** Oficina encaixa cliente o tempo todo;
 *    travar faria a oficina marcar por fora do sistema. Sem `force`, a resposta
 *    é 422 `APPOINTMENT_CONFLICT` com quem colide — a tela pergunta "confirmar
 *    mesmo assim?" e repete o pedido com `force: true`.
 * 2. **Hora é instante.** Tudo entra e sai em ISO com fuso; quem desenha na
 *    parede da oficina é `shared/calendar.ts`, com o fuso de `organizations`.
 */
export class AppointmentsService {
  constructor(
    private readonly deps: ServiceDeps,
    private readonly workOrders: WorkOrdersService,
  ) {}

  async list(auth: AuthContext, query: AppointmentListQuery): Promise<{ data: Appointment[] }> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const rows = await repo.listAppointments(tx, auth.organizationId, query);
      return { data: rows.map(toDto) };
    });
  }

  async get(auth: AuthContext, id: string): Promise<Appointment> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const row = await repo.findAppointment(tx, auth.organizationId, id);
      if (!row) throw notFound('Agendamento não encontrado.');
      return toDto(row);
    });
  }

  /** Conferência enquanto a pessoa preenche: a tela avisa antes de tentar gravar. */
  async conflicts(auth: AuthContext, query: ConflictQuery): Promise<{ data: AppointmentConflict[] }> {
    if (!query.mechanicId) return { data: [] };
    return withTenant(this.deps.db, auth, async (tx) => {
      const rows = await this.buscarConflitos(tx, auth.organizationId, {
        mechanicUserId: query.mechanicId ?? null,
        startsAt: new Date(query.startsAt),
        endsAt: new Date(query.endsAt),
        excludeId: query.excludeId ?? null,
      });
      return { data: rows.map(toConflict) };
    });
  }

  async create(auth: AuthContext, input: CreateAppointmentInput, client: ClientInfo): Promise<Appointment> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const startsAt = new Date(input.startsAt);
      const endsAt = new Date(input.endsAt);
      await this.validarPessoas(tx, auth.organizationId, {
        customerId: input.customerId,
        vehicleId: input.vehicleId,
        mechanicUserId: input.mechanicUserId,
      });
      const forcado = await this.conferirConflito(
        tx,
        auth.organizationId,
        { mechanicUserId: input.mechanicUserId, startsAt, endsAt },
        input.force,
      );

      const agendamento = await repo.insertAppointment(tx, {
        organizationId: auth.organizationId,
        customerId: input.customerId,
        vehicleId: input.vehicleId,
        mechanicUserId: input.mechanicUserId,
        serviceId: input.serviceId,
        title: input.title,
        startsAt,
        endsAt,
        notes: blankToNull(input.notes),
        createdBy: auth.userId,
      });

      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'appointment.created',
        entityType: 'appointment',
        entityId: agendamento.id,
        metadata: { title: agendamento.title, startsAt: startsAt.toISOString(), forced: forcado },
        ...client,
      });
      return this.carregar(tx, auth.organizationId, agendamento.id);
    });
  }

  /** Remarcar. É também o que o arrastar e soltar manda. */
  async reschedule(
    auth: AuthContext,
    id: string,
    input: RescheduleAppointmentInput,
    client: ClientInfo,
  ): Promise<Appointment> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const atual = await repo.lockAppointment(tx, auth.organizationId, id);
      if (!atual) throw notFound('Agendamento não encontrado.');
      if (!isReschedulable(atual.status)) {
        throw new AppError(
          422,
          ErrorCode.INVALID_TRANSITION,
          'Agendamento encerrado',
          atual.status === 'IN_PROGRESS'
            ? 'O veículo já entrou: mude a data pela ordem de serviço.'
            : 'Este agendamento já foi encerrado e não pode ser remarcado.',
        );
      }

      const startsAt = input.startsAt ? new Date(input.startsAt) : atual.startsAt;
      const endsAt = input.endsAt ? new Date(input.endsAt) : atual.endsAt;
      const mechanicUserId =
        input.mechanicUserId !== undefined ? input.mechanicUserId : atual.mechanicUserId;
      const vehicleId = input.vehicleId !== undefined ? input.vehicleId : atual.vehicleId;

      await this.validarPessoas(tx, auth.organizationId, {
        customerId: atual.customerId,
        vehicleId,
        mechanicUserId,
      });

      const mudouHorario =
        startsAt.getTime() !== atual.startsAt.getTime() ||
        endsAt.getTime() !== atual.endsAt.getTime() ||
        mechanicUserId !== atual.mechanicUserId;
      const forcado = mudouHorario
        ? await this.conferirConflito(
            tx,
            auth.organizationId,
            { mechanicUserId, startsAt, endsAt, excludeId: atual.id },
            input.force ?? false,
          )
        : false;

      await repo.updateAppointment(tx, atual.id, {
        startsAt,
        endsAt,
        mechanicUserId,
        vehicleId,
        serviceId: input.serviceId !== undefined ? input.serviceId : atual.serviceId,
        title: input.title ?? atual.title,
        notes: input.notes !== undefined ? blankToNull(input.notes) : atual.notes,
      });

      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'appointment.rescheduled',
        entityType: 'appointment',
        entityId: atual.id,
        changes: {
          startsAt: { from: atual.startsAt.toISOString(), to: startsAt.toISOString() },
          mechanicUserId: { from: atual.mechanicUserId, to: mechanicUserId },
        },
        metadata: { forced: forcado },
        ...client,
      });
      return this.carregar(tx, auth.organizationId, atual.id);
    });
  }

  /**
   * Confirmar, concluir, cancelar e marcar falta. Cada uma é ação explícita,
   * com a própria permissão na máquina de estados e a própria linha na
   * auditoria — nunca um `PATCH status`.
   */
  async transition(
    auth: AuthContext,
    id: string,
    action: Exclude<AppointmentAction, 'check-in'>,
    client: ClientInfo,
    input?: CancelAppointmentInput,
  ): Promise<Appointment> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const atual = await repo.lockAppointment(tx, auth.organizationId, id);
      if (!atual) throw notFound('Agendamento não encontrado.');
      const destino = APPOINTMENT_TRANSITIONS[action];
      if (!canTransitionAppointment(atual.status, action)) {
        throw new AppError(
          422,
          ErrorCode.INVALID_TRANSITION,
          'Ação indisponível',
          `Não dá para ${destino.label.toLowerCase()} um agendamento nesta situação.`,
        );
      }

      const agora = new Date();
      const reason = input?.reason.trim();
      await repo.updateAppointment(tx, atual.id, {
        status: destino.to,
        confirmedAt: action === 'confirm' ? agora : atual.confirmedAt,
        canceledAt: action === 'cancel' ? agora : atual.canceledAt,
        cancelReason: action === 'cancel' ? (reason ?? null) : atual.cancelReason,
      });

      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: `appointment.${action.replace('-', '_')}`,
        entityType: 'appointment',
        entityId: atual.id,
        changes: { status: { from: atual.status, to: destino.to } },
        metadata: reason ? { reason } : null,
        ...client,
      });
      return this.carregar(tx, auth.organizationId, atual.id);
    });
  }

  /**
   * O carro chegou: a OS nasce aqui, com o agendamento ligado dos dois lados, na
   * MESMA transação — ou as duas coisas acontecem, ou nenhuma. A vistoria com
   * fotos continua sendo o passo seguinte, na tela da OS (E5).
   */
  async checkIn(
    auth: AuthContext,
    id: string,
    input: AppointmentCheckInInput,
    client: ClientInfo,
  ): Promise<WorkOrder> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const atual = await repo.lockAppointment(tx, auth.organizationId, id);
      if (!atual) throw notFound('Agendamento não encontrado.');
      if (atual.workOrderId) {
        throw new AppError(
          409,
          ErrorCode.APPOINTMENT_ALREADY_CHECKED_IN,
          'Check-in já feito',
          'Este agendamento já tem uma ordem de serviço aberta.',
        );
      }
      if (!canTransitionAppointment(atual.status, 'check-in')) {
        throw new AppError(
          422,
          ErrorCode.INVALID_TRANSITION,
          'Ação indisponível',
          'Só dá para fazer check-in de agendamento que ainda está de pé.',
        );
      }

      const vehicleId = input.vehicleId ?? atual.vehicleId;
      if (!vehicleId) {
        throw validationFailed([
          { path: 'body.vehicleId', message: 'Escolha o veículo que chegou para atendimento' },
        ]);
      }

      const order = await this.workOrders.createInTx(
        tx,
        auth,
        {
          customerId: atual.customerId,
          vehicleId,
          appointmentId: atual.id,
          odometerKm: input.odometerKm,
          complaint: input.complaint || atual.notes || '',
          promisedAt: input.promisedAt,
          advisorUserId: input.advisorUserId,
          mechanicUserId: input.mechanicUserId ?? atual.mechanicUserId,
          items: [],
        },
        client,
      );

      await repo.updateAppointment(tx, atual.id, {
        status: 'IN_PROGRESS',
        workOrderId: order.id,
        vehicleId,
      });

      // a OS precisa dizer de onde veio: quem abre a ficha entende o histórico
      const timezone = await readTimezone(tx, auth.organizationId);
      await workOrderRepo.insertEvent(tx, {
        organizationId: auth.organizationId,
        workOrderId: order.id,
        type: 'NOTE',
        data: { text: `Aberta pelo agendamento de ${faixaTexto(atual.startsAt, atual.endsAt, timezone)}.` },
        actorUserId: auth.userId,
      });
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'appointment.checked_in',
        entityType: 'appointment',
        entityId: atual.id,
        workOrderId: order.id,
        metadata: { number: order.number },
        ...client,
      });
      return order;
    });
  }

  /**
   * Confirmação pelo WhatsApp. Como em "veículo pronto" (E7), a API devolve a
   * mensagem pronta e o link `wa.me`; quem aperta enviar é a pessoa da oficina.
   * O envio fica registrado, senão ninguém sabe se o cliente foi avisado.
   */
  async confirmationMessage(
    auth: AuthContext,
    id: string,
    client: ClientInfo,
  ): Promise<{ message: string; whatsappUrl: string | null }> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const row = await repo.findAppointment(tx, auth.organizationId, id);
      if (!row) throw notFound('Agendamento não encontrado.');

      const oficina = await workOrderRepo.findOrganization(tx, auth.organizationId);
      const timezone = await readTimezone(tx, auth.organizationId);
      const message = whatsappAppointmentMessage({
        customerName: row.customerName,
        shopName: oficina?.name ?? 'Oficina',
        when: formatWhen(row.appointment.startsAt, timezone),
        title: row.appointment.title,
        vehicle: row.vehicleMake
          ? { make: row.vehicleMake, model: row.vehicleModel ?? '', plate: row.vehiclePlate }
          : null,
      });
      const whatsapp = row.customerWhatsapp ?? row.customerPhone;

      await workOrderRepo.insertMessage(tx, {
        organizationId: auth.organizationId,
        customerId: row.appointment.customerId,
        channel: 'WHATSAPP_LINK',
        direction: 'OUTBOUND',
        templateKey: 'APPOINTMENT_CONFIRMATION',
        body: message,
        toAddress: whatsapp,
        // o link wa.me não confirma entrega: é o que realmente sabemos
        status: 'LINK_OPENED',
        sentBy: auth.userId,
      });
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'appointment.confirmation_sent',
        entityType: 'appointment',
        entityId: id,
        metadata: { temWhatsapp: Boolean(whatsapp) },
        ...client,
      });
      return { message, whatsappUrl: whatsapp ? whatsappLink(whatsapp, message) : null };
    });
  }

  // ------------------------------- apoio ----------------------------------

  private async carregar(tx: Tx, organizationId: string, id: string): Promise<Appointment> {
    const row = await repo.findAppointment(tx, organizationId, id);
    if (!row) throw notFound('Agendamento não encontrado.');
    return toDto(row);
  }

  /** Cliente, veículo e mecânico têm de existir NESTA oficina — e combinar entre si. */
  private async validarPessoas(
    tx: Tx,
    organizationId: string,
    input: { customerId: string; vehicleId: string | null; mechanicUserId: string | null },
  ): Promise<void> {
    const cliente = await customerRepo.findCustomer(tx, organizationId, input.customerId);
    if (!cliente || cliente.customer.deletedAt) {
      throw validationFailed([{ path: 'body.customerId', message: 'Cliente não encontrado' }]);
    }
    if (input.vehicleId) {
      const veiculo = await workOrderRepo.findVehicleWithCustomer(tx, organizationId, input.vehicleId);
      if (!veiculo || veiculo.deletedAt) {
        throw validationFailed([{ path: 'body.vehicleId', message: 'Veículo não encontrado' }]);
      }
      if (veiculo.customerId !== input.customerId) {
        throw validationFailed([{ path: 'body.vehicleId', message: 'Este veículo é de outro cliente' }]);
      }
    }
    if (input.mechanicUserId) {
      const membro = await repo.findActiveMember(tx, organizationId, input.mechanicUserId);
      if (!membro?.isActive) {
        throw validationFailed([{ path: 'body.mechanicUserId', message: 'Esta pessoa não está na equipe' }]);
      }
    }
  }

  /**
   * Quem disputa o horário. O banco só aproxima (mesmo mecânico, por perto); a
   * regra do intervalo meio-aberto é a do shared, testada uma vez só.
   */
  private async buscarConflitos(
    tx: Tx,
    organizationId: string,
    candidate: { mechanicUserId: string | null; startsAt: Date; endsAt: Date; excludeId?: string | null },
  ): Promise<repo.AppointmentDetail[]> {
    const mechanicUserId = candidate.mechanicUserId;
    if (!mechanicUserId) return [];
    const rows = await repo.overlapCandidates(
      tx,
      organizationId,
      mechanicUserId,
      candidate.startsAt,
      candidate.endsAt,
    );
    const ids = new Set(findConflicts({ ...candidate, mechanicUserId }, rows.map(toSlot)).map((c) => c.id));
    return rows.filter((row) => ids.has(row.appointment.id));
  }

  /**
   * Sem `force`, horário disputado é 422 com quem colide. Devolve se o encaixe
   * foi forçado, para a auditoria registrar que alguém decidiu marcar assim.
   */
  private async conferirConflito(
    tx: Tx,
    organizationId: string,
    candidate: { mechanicUserId: string | null; startsAt: Date; endsAt: Date; excludeId?: string | null },
    force: boolean,
  ): Promise<boolean> {
    const rows = await this.buscarConflitos(tx, organizationId, candidate);
    if (!rows.length) return false;
    if (force) return true;

    const timezone = await readTimezone(tx, organizationId);
    const errors: FieldError[] = rows.map((row) => ({
      path: 'body.startsAt',
      message: `${row.mechanicName ?? 'O mecânico'} já tem "${row.appointment.title}" (${row.customerName}) ${faixaTexto(row.appointment.startsAt, row.appointment.endsAt, timezone)}`,
    }));
    throw new AppError(
      422,
      ErrorCode.APPOINTMENT_CONFLICT,
      'Horário já ocupado',
      rows.length === 1
        ? 'Já existe um agendamento nesse horário para este mecânico.'
        : `Já existem ${rows.length} agendamentos nesse horário para este mecânico.`,
      errors,
    );
  }
}
