import {
  dayKey,
  devidoCents,
  distribuirPagamento,
  statusDoLancamento,
  type SystemFinancialCategoryKey,
} from '@oficinaos/shared';
import { readTimezone } from '../../core/org-settings';
import type { Tx } from '../../db/tenant';
import * as paymentsRepo from '../payments/payments.repository';
import * as repo from './finance.repository';

/**
 * O financeiro visto pelos OUTROS módulos (E13). Mora num arquivo próprio, e
 * não no service, porque a OS, o pagamento e a compra precisam mexer no
 * financeiro **dentro da transação deles** — chamar um service abriria uma
 * segunda transação e o lock da primeira ficaria esperando por si mesmo.
 *
 * A regra que manda aqui: **a conta a receber espelha a OS**. O valor é o que o
 * cliente aprovou e o pago é a soma dos pagamentos daquela OS (a verdade do
 * caixa continua sendo `payments`, da E7). Nada é contado duas vezes.
 */

/** Hoje no calendário da oficina — "vence hoje" em Manaus não é o do servidor. */
export async function hojeNaOficina(tx: Tx, organizationId: string): Promise<string> {
  return dayKey(new Date(), await readTimezone(tx, organizationId));
}

async function categoriaDoSistema(
  tx: Tx,
  organizationId: string,
  key: SystemFinancialCategoryKey,
): Promise<string | null> {
  const row = await repo.findCategoryByKey(tx, organizationId, key);
  return row?.id ?? null;
}

interface OrdemParaFinanceiro {
  id: string;
  number: number;
  customerId: string;
  approvedTotalCents: number;
  totalCents: number;
  status: string;
}

/**
 * A OS foi finalizada: nasce a conta a receber. Idempotente — finalizar,
 * reabrir e finalizar de novo não cria duas contas.
 */
export async function ensureWorkOrderReceivable(
  tx: Tx,
  organizationId: string,
  order: OrdemParaFinanceiro,
  userId: string,
): Promise<void> {
  const devido = devidoCents(order);
  if (devido <= 0) return;
  const existentes = await repo.lockEntriesOfWorkOrder(tx, organizationId, order.id);
  if (existentes.length === 0) {
    await repo.insertEntries(tx, [
      {
        organizationId,
        direction: 'RECEIVABLE',
        origin: 'WORK_ORDER',
        categoryId: await categoriaDoSistema(tx, organizationId, 'SERVICES'),
        description: `OS nº ${order.number}`,
        amountCents: devido,
        dueDate: await hojeNaOficina(tx, organizationId),
        customerId: order.customerId,
        workOrderId: order.id,
        createdBy: userId,
      },
    ]);
  }
  await syncWorkOrderEntries(tx, organizationId, order);
}

/**
 * Mantém a(s) conta(s) da OS coladas na OS: valor igual ao aprovado e pago
 * igual à soma dos pagamentos, espalhado **da parcela mais velha para a mais
 * nova**. Roda em toda gravação da OS (`applyWorkOrderChange`), então aprovar
 * item, dar desconto ou registrar pagamento já deixa o financeiro certo.
 *
 * Com carnê (duas parcelas ou mais) os valores combinados NÃO são mexidos: a
 * oficina acertou aquelas parcelas com o cliente. Só a distribuição do que foi
 * pago é refeita.
 */
export async function syncWorkOrderEntries(
  tx: Tx,
  organizationId: string,
  order: OrdemParaFinanceiro,
): Promise<void> {
  const entries = await repo.lockEntriesOfWorkOrder(tx, organizationId, order.id);
  if (!entries.length) return;

  const pago = await paymentsRepo.sumConfirmedCents(tx, organizationId, order.id);
  const devido = devidoCents(order);

  if (entries.length === 1 && entries[0]!.installmentCount === 1) {
    // o total da OS mudou (item aprovado, desconto, orçamento complementar).
    // Nunca abaixo do que já foi pago: o CHECK do banco não deixa, e reduzir
    // uma conta já recebida esconderia o crédito em vez de mostrá-lo
    const alvo = Math.max(devido, pago, 1);
    if (alvo !== entries[0]!.amountCents) {
      entries[0] = await repo.updateEntry(tx, entries[0]!.id, { amountCents: alvo });
    }
  }

  const fatias = distribuirPagamento(pago, entries);
  for (const [index, entry] of entries.entries()) {
    const pagoNaParcela = fatias[index]!;
    const status = statusDoLancamento(pagoNaParcela, entry.amountCents);
    if (pagoNaParcela === entry.paidCents && status === entry.status) continue;
    await repo.updateEntry(tx, entry.id, {
      paidCents: pagoNaParcela,
      status,
      settledAt: status === 'PAID' ? (entry.settledAt ?? new Date()) : null,
    });
  }
}

/** OS cancelada: a conta dela morre junto, com motivo — não some do histórico. */
export async function cancelWorkOrderEntries(
  tx: Tx,
  organizationId: string,
  workOrderId: string,
  reason: string,
  userId: string,
): Promise<number> {
  const entries = await repo.lockEntriesOfWorkOrder(tx, organizationId, workOrderId);
  for (const entry of entries) {
    await repo.updateEntry(tx, entry.id, {
      status: 'CANCELED',
      canceledAt: new Date(),
      canceledBy: userId,
      cancelReason: reason,
    });
  }
  return entries.length;
}

/**
 * A mercadoria chegou (E12): nasce a conta a pagar daquela nota. É por
 * RECEBIMENTO, não por pedido — o que a oficina deve é o que veio na nota, e
 * uma compra parcial vira duas contas, como o fornecedor cobra.
 */
export async function createPurchasePayable(
  tx: Tx,
  organizationId: string,
  input: {
    purchaseOrderId: string;
    purchaseNumber: number;
    supplierId: string;
    invoiceNumber: string | null;
    amountCents: number;
    dueDate: string | null;
    userId: string;
  },
): Promise<void> {
  if (input.amountCents <= 0) return;
  await repo.insertEntries(tx, [
    {
      organizationId,
      direction: 'PAYABLE',
      origin: 'PURCHASE',
      categoryId: await categoriaDoSistema(tx, organizationId, 'PARTS'),
      description: input.invoiceNumber
        ? `Compra nº ${input.purchaseNumber} — NF ${input.invoiceNumber}`
        : `Compra nº ${input.purchaseNumber}`,
      amountCents: input.amountCents,
      dueDate: input.dueDate ?? (await hojeNaOficina(tx, organizationId)),
      supplierId: input.supplierId,
      purchaseOrderId: input.purchaseOrderId,
      createdBy: input.userId,
    },
  ]);
}

/**
 * Devolveu ao fornecedor: a conta a pagar daquela compra encolhe. Abate da
 * nota mais recente para a mais antiga e nunca abaixo do que já foi pago — o
 * que sobrar de crédito com o fornecedor a oficina resolve na próxima nota
 * (crédito lançado é V3).
 *
 * Devolveu tudo de uma nota ainda não paga? A conta é cancelada, porque
 * lançamento de valor zero não existe.
 */
export async function reducePurchasePayable(
  tx: Tx,
  organizationId: string,
  purchaseOrderId: string,
  valorCents: number,
  userId: string,
): Promise<number> {
  let restante = valorCents;
  let abatido = 0;
  const entries = await repo.listEntriesOfPurchaseOrder(tx, organizationId, purchaseOrderId);
  for (const entry of entries) {
    if (restante <= 0) break;
    const podeAbater = Math.min(restante, entry.amountCents - entry.paidCents);
    if (podeAbater <= 0) continue;
    const novoValor = entry.amountCents - podeAbater;
    if (novoValor === 0) {
      await repo.updateEntry(tx, entry.id, {
        status: 'CANCELED',
        canceledAt: new Date(),
        canceledBy: userId,
        cancelReason: 'Mercadoria devolvida ao fornecedor',
      });
    } else {
      await repo.updateEntry(tx, entry.id, {
        amountCents: novoValor,
        status: statusDoLancamento(entry.paidCents, novoValor),
      });
    }
    restante -= podeAbater;
    abatido += podeAbater;
  }
  return abatido;
}
