import { devidoCents, statusDoPagamento, type PaymentMethod } from '@oficinaos/shared';
import type { Tx } from '../../db/tenant';
import { applyWorkOrderChange } from '../work-orders/totals';
import * as workOrderRepo from '../work-orders/work-orders.repository';
import * as repo from './payments.repository';

/**
 * Baixa no caixa da OS, para quem não é a tela do caixa chamar (E19).
 *
 * A cobrança online precisa registrar o dinheiro exatamente como o balcão
 * registra — mesma tabela, mesmo recálculo, mesma sincronia com a conta a
 * receber (D30). Duplicar essa conta dentro do módulo de cobrança seria
 * garantir que um dia "recebido" mostre dois números diferentes.
 */
export async function recalcularPagamentoDaOs(
  tx: Tx,
  organizationId: string,
  order: workOrderRepo.WorkOrderRow,
): Promise<void> {
  const pago = await repo.sumConfirmedCents(tx, organizationId, order.id);
  await applyWorkOrderChange(tx, order, {
    paidCents: pago,
    paymentStatus: statusDoPagamento(pago, devidoCents(order)),
  });
}

/**
 * O dinheiro da cobrança entrou: vira pagamento da OS. Devolve o pagamento
 * criado (é ele que a cobrança guarda) — ou o que já existia, se o aviso do
 * gateway chegar repetido.
 */
export async function registrarPagamentoDaCobranca(
  tx: Tx,
  input: {
    organizationId: string;
    order: workOrderRepo.WorkOrderRow;
    customerId: string;
    method: PaymentMethod;
    amountCents: number;
    paidAt: Date;
    clientRequestId: string;
    provider: string;
    providerPaymentId: string | null;
    createdBy: string;
    notes: string;
  },
) {
  const repetido = await repo.findByClientRequest(tx, input.organizationId, input.clientRequestId);
  if (repetido) return repetido;

  const pagamento = await repo.insertPayment(tx, {
    organizationId: input.organizationId,
    workOrderId: input.order.id,
    customerId: input.customerId,
    method: input.method,
    amountCents: input.amountCents,
    installments: 1,
    paidAt: input.paidAt,
    clientRequestId: input.clientRequestId,
    provider: input.provider,
    providerPaymentId: input.providerPaymentId,
    notes: input.notes,
    createdBy: input.createdBy,
  });
  await recalcularPagamentoDaOs(tx, input.organizationId, input.order);
  return pagamento;
}
