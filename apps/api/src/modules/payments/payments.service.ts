import type { z } from 'zod';
import {
  devidoCents,
  ErrorCode,
  formatBRL,
  statusDoPagamento,
  type cancelPaymentSchema,
  type Payment,
  type PaymentList,
  type recordPaymentSchema,
} from '@oficinaos/shared';
import { recordActivity } from '../../core/audit';
import type { AuthContext, ClientInfo, ServiceDeps } from '../../core/auth-context';
import { AppError, notFound } from '../../core/errors';
import { blankToNull, isoOrNull } from '../../core/normalize';
import type { Tx } from '../../db/tenant';
import { withTenant } from '../../db/tenant';
import * as workOrderRepo from '../work-orders/work-orders.repository';
import { applyWorkOrderChange } from '../work-orders/totals';
import * as repo from './payments.repository';

type RecordInput = z.output<typeof recordPaymentSchema>;
type CancelInput = z.output<typeof cancelPaymentSchema>;

const toDto = (
  row: repo.PaymentRow,
  recordedByName: string | null,
  canceledByName: string | null,
): Payment => ({
  id: row.id,
  method: row.method,
  amountCents: row.amountCents,
  installments: row.installments,
  status: row.status,
  paidAt: row.paidAt.toISOString(),
  notes: row.notes,
  recordedByName,
  canceledByName,
  canceledAt: isoOrNull(row.canceledAt),
  cancelReason: row.cancelReason,
  createdAt: row.createdAt.toISOString(),
});

/**
 * Pagamento no MVP 1: a oficina **registra** o que recebeu (ARCHITECTURE §7,
 * nota 5 — o atendente é o caixa). Nada é cobrado aqui; gateway é V3.
 */
export class PaymentsService {
  constructor(private readonly deps: ServiceDeps) {}

  async list(auth: AuthContext, workOrderId: string): Promise<PaymentList> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const order = await workOrderRepo.findWorkOrder(tx, auth.organizationId, { id: workOrderId });
      if (!order) throw notFound('OS não encontrada.');
      return this.carregar(tx, auth.organizationId, workOrderId, devidoCents(order.order));
    });
  }

  async record(auth: AuthContext, workOrderId: string, input: RecordInput, client: ClientInfo): Promise<PaymentList> {
    return withTenant(this.deps.db, auth, async (tx) => {
      // trava a OS: dois caixas registrando ao mesmo tempo não furam o saldo
      const order = await workOrderRepo.lockWorkOrder(tx, auth.organizationId, workOrderId);
      if (!order) throw notFound('OS não encontrada.');
      if (order.status === 'CANCELED') {
        throw new AppError(
          422,
          ErrorCode.INVALID_TRANSITION,
          'OS cancelada',
          'Não dá para registrar pagamento numa OS cancelada.',
        );
      }

      const devido = devidoCents(order);
      const pago = await repo.sumConfirmedCents(tx, auth.organizationId, workOrderId);
      const falta = Math.max(0, devido - pago);
      if (input.amountCents > falta) {
        throw new AppError(
          422,
          ErrorCode.PAYMENT_EXCEEDS_BALANCE,
          'Valor acima do saldo',
          falta === 0
            ? 'Esta OS já está paga.'
            : `Falta receber ${formatBRL(falta)}. Registre no máximo esse valor.`,
          [{ path: 'body.amountCents', message: `O máximo é ${formatBRL(falta)}` }],
        );
      }

      const pagamento = await repo.insertPayment(tx, {
        organizationId: auth.organizationId,
        workOrderId,
        customerId: order.customerId,
        method: input.method,
        amountCents: input.amountCents,
        installments: input.installments,
        paidAt: input.paidAt ? new Date(input.paidAt) : new Date(),
        notes: blankToNull(input.notes) ?? null,
        createdBy: auth.userId,
      });

      await this.recalcular(tx, auth.organizationId, order, workOrderId);

      await workOrderRepo.insertEvent(tx, {
        organizationId: auth.organizationId,
        workOrderId,
        type: 'PAYMENT',
        data: { method: pagamento.method, amountCents: pagamento.amountCents, installments: pagamento.installments },
        actorUserId: auth.userId,
      });
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'payment.recorded',
        entityType: 'payment',
        entityId: pagamento.id,
        metadata: { number: order.number, method: pagamento.method, amountCents: pagamento.amountCents },
        ...client,
      });

      return this.carregar(tx, auth.organizationId, workOrderId, devido);
    });
  }

  /** Erro de digitação não se apaga: vira cancelado, com motivo e autor. */
  async cancel(auth: AuthContext, paymentId: string, input: CancelInput, client: ClientInfo): Promise<PaymentList> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const pagamento = await repo.lockPayment(tx, auth.organizationId, paymentId);
      if (!pagamento) throw notFound('Pagamento não encontrado.');
      if (pagamento.status === 'CANCELED') {
        throw new AppError(
          409,
          ErrorCode.PAYMENT_ALREADY_CANCELED,
          'Pagamento já cancelado',
          'Este lançamento já estava cancelado.',
        );
      }
      if (!pagamento.workOrderId) throw notFound('Pagamento sem OS.');

      const order = await workOrderRepo.lockWorkOrder(tx, auth.organizationId, pagamento.workOrderId);
      if (!order) throw notFound('OS não encontrada.');

      await repo.updatePayment(tx, pagamento.id, {
        status: 'CANCELED',
        canceledAt: new Date(),
        canceledBy: auth.userId,
        cancelReason: input.reason.trim(),
      });

      await this.recalcular(tx, auth.organizationId, order, pagamento.workOrderId);

      // dinheiro saindo tem de aparecer onde a oficina lê o que aconteceu com o
      // carro: estorno invisível na timeline vira discussão com o cliente depois
      await workOrderRepo.insertEvent(tx, {
        organizationId: auth.organizationId,
        workOrderId: pagamento.workOrderId,
        type: 'PAYMENT',
        data: {
          canceled: true,
          method: pagamento.method,
          amountCents: pagamento.amountCents,
          reason: input.reason.trim(),
        },
        actorUserId: auth.userId,
      });
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'payment.canceled',
        entityType: 'payment',
        entityId: pagamento.id,
        metadata: { number: order.number, amountCents: pagamento.amountCents, reason: input.reason.trim() },
        ...client,
      });

      return this.carregar(tx, auth.organizationId, pagamento.workOrderId, devidoCents(order));
    });
  }

  /**
   * `paid_cents` e `payment_status` da OS saem SEMPRE da soma dos lançamentos
   * confirmados — nunca de valor mandado pela tela, como nos totais do §9.
   */
  private async recalcular(
    tx: Tx,
    organizationId: string,
    order: workOrderRepo.WorkOrderRow,
    workOrderId: string,
  ): Promise<void> {
    const pago = await repo.sumConfirmedCents(tx, organizationId, workOrderId);
    await applyWorkOrderChange(tx, order, {
      paidCents: pago,
      paymentStatus: statusDoPagamento(pago, devidoCents(order)),
    });
  }

  private async carregar(tx: Tx, organizationId: string, workOrderId: string, devido: number): Promise<PaymentList> {
    const rows = await repo.listPayments(tx, organizationId, workOrderId);
    const pago = await repo.sumConfirmedCents(tx, organizationId, workOrderId);
    return {
      data: rows.map((row) => toDto(row.payment, row.recordedByName, row.canceledByName)),
      paidCents: pago,
      balanceCents: Math.max(0, devido - pago),
    };
  }
}
