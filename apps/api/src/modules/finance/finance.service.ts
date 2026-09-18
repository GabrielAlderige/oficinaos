import { and, eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import {
  daysBetween,
  diasDeAtraso,
  dividirEmParcelas,
  ErrorCode,
  faltaCents,
  formatBRL,
  lucroEstimado,
  periodRange,
  situacaoDoLancamento,
  startOfMonth,
  startOfWeek,
  statusDoLancamento,
  SYSTEM_FINANCIAL_CATEGORIES,
  vencimentosMensais,
  type CashFlow,
  type CashFlowBucket,
  type CreateFinancialEntryInput,
  type FinancialCategory,
  type FinancialDirection,
  type FinancialEntry,
  type FinancialEntryDetail,
  type FinancialList,
  type FinancialListQuery,
  type FinancialPeriodQuery,
  type FinancialSettlement,
  type ProfitReport,
  type SettleFinancialEntryInput,
  type SplitFinancialEntryInput,
  type UpdateFinancialEntryInput,
} from '@oficinaos/shared';
import { recordActivity } from '../../core/audit';
import { workOrders } from '../../db/schema';
import type { AuthContext, ClientInfo, ServiceDeps } from '../../core/auth-context';
import { AppError, notFound } from '../../core/errors';
import { blankToNull } from '../../core/normalize';
import { readTimezone } from '../../core/org-settings';
import type { Tx } from '../../db/tenant';
import { withTenant } from '../../db/tenant';
import type { PaymentsService } from '../payments/payments.service';
import * as repo from './finance.repository';
import { hojeNaOficina, syncWorkOrderEntries } from './finance.sync';

const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const diaEMes = (key: string) => `${key.slice(8)}/${key.slice(5, 7)}`;

function toDto(row: repo.FinancialEntryJoined, hoje: string): FinancialEntry {
  const entry = row.entry;
  const emAberto = entry.status === 'OPEN' || entry.status === 'PARTIAL';
  return {
    id: entry.id,
    direction: entry.direction,
    status: entry.status,
    situation: situacaoDoLancamento(entry, hoje),
    overdueDays: emAberto ? diasDeAtraso(entry.dueDate, hoje) : 0,
    origin: entry.origin,
    description: entry.description,
    amountCents: entry.amountCents,
    paidCents: entry.paidCents,
    remainingCents: faltaCents(entry),
    dueDate: entry.dueDate,
    categoryId: entry.categoryId,
    categoryName: row.categoryName,
    customerId: entry.customerId,
    customerName: row.customerName,
    supplierId: entry.supplierId,
    supplierName: row.supplierName,
    workOrderId: entry.workOrderId,
    workOrderNumber: row.workOrderNumber,
    purchaseOrderId: entry.purchaseOrderId,
    purchaseOrderNumber: row.purchaseOrderNumber,
    installmentNumber: entry.installmentNumber,
    installmentCount: entry.installmentCount,
    notes: entry.notes,
    cancelReason: entry.cancelReason,
    createdAt: entry.createdAt.toISOString(),
  };
}

/**
 * Financeiro da oficina (E13): contas a receber e a pagar, baixa, fluxo de
 * caixa e lucro estimado.
 *
 * Duas regras mandam aqui:
 *
 * 1. **A conta de uma OS espelha a OS.** O valor é o que o cliente aprovou e a
 *    baixa é o pagamento do caixa (E7) — a tela do financeiro registra o
 *    pagamento na OS, não um lançamento paralelo. Assim "recebido" é um número
 *    só no sistema inteiro.
 * 2. **`paid_cents` nunca vem da tela.** Sai da soma das baixas confirmadas,
 *    como o `paid_cents` da OS sai da soma dos pagamentos.
 */
export class FinanceService {
  constructor(
    private readonly deps: ServiceDeps,
    private readonly payments: PaymentsService,
  ) {}

  // ------------------------------ categorias ------------------------------

  async listCategories(auth: AuthContext, direction?: FinancialDirection): Promise<{ data: FinancialCategory[] }> {
    return withTenant(this.deps.db, auth, async (tx) => {
      // oficina criada antes da E13 já ganhou as categorias na migration 0028;
      // esta rede de segurança cobre a oficina criada por um caminho novo
      const rows = await repo.listCategories(tx, auth.organizationId, direction);
      if (!rows.length) {
        await repo.insertDefaultCategories(tx, auth.organizationId, SYSTEM_FINANCIAL_CATEGORIES);
        return { data: (await repo.listCategories(tx, auth.organizationId, direction)).map(categoriaDto) };
      }
      return { data: rows.map(categoriaDto) };
    });
  }

  async createCategory(
    auth: AuthContext,
    input: { name: string; direction: FinancialDirection },
    client: ClientInfo,
  ): Promise<FinancialCategory> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const existentes = await repo.listCategories(tx, auth.organizationId, input.direction);
      if (existentes.some((row) => row.category.name.toLowerCase() === input.name.toLowerCase())) {
        throw new AppError(
          409,
          ErrorCode.FINANCE_CATEGORY_NAME_TAKEN,
          'Categoria já existe',
          `Já existe "${input.name}" nesta lista.`,
        );
      }
      const row = await repo.insertCategory(tx, {
        organizationId: auth.organizationId,
        direction: input.direction,
        name: input.name,
      });
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'finance.category_created',
        entityType: 'financial_category',
        entityId: row.id,
        metadata: { name: row.name, direction: row.direction },
        ...client,
      });
      return { id: row.id, name: row.name, direction: row.direction, systemKey: row.systemKey, entryCount: 0 };
    });
  }

  /** Renomear é permitido até nas do sistema ("Aluguel" → "Aluguel do galpão"). */
  async renameCategory(auth: AuthContext, id: string, name: string, client: ClientInfo): Promise<FinancialCategory> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const atual = await repo.findCategory(tx, auth.organizationId, id);
      if (!atual) throw notFound('Categoria não encontrada.');
      const existentes = await repo.listCategories(tx, auth.organizationId, atual.direction);
      if (existentes.some((row) => row.category.id !== id && row.category.name.toLowerCase() === name.toLowerCase())) {
        throw new AppError(409, ErrorCode.FINANCE_CATEGORY_NAME_TAKEN, 'Categoria já existe', `Já existe "${name}".`);
      }
      const row = await repo.updateCategory(tx, id, { name });
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'finance.category_renamed',
        entityType: 'financial_category',
        entityId: id,
        changes: { name: { from: atual.name, to: name } },
        ...client,
      });
      const contagem = existentes.find((row2) => row2.category.id === id)?.entryCount ?? 0;
      return { id: row.id, name: row.name, direction: row.direction, systemKey: row.systemKey, entryCount: contagem };
    });
  }

  async deleteCategory(auth: AuthContext, id: string, client: ClientInfo): Promise<void> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const atual = await repo.findCategory(tx, auth.organizationId, id);
      if (!atual) throw notFound('Categoria não encontrada.');
      if (atual.systemKey) {
        throw new AppError(
          422,
          ErrorCode.FINANCE_CATEGORY_IN_USE,
          'Categoria do sistema',
          'Esta categoria faz parte do sistema. Dá para renomear, mas não para apagar.',
        );
      }
      const linhas = await repo.listCategories(tx, auth.organizationId, atual.direction);
      const emUso = linhas.find((row) => row.category.id === id)?.entryCount ?? 0;
      if (emUso > 0) {
        throw new AppError(
          422,
          ErrorCode.FINANCE_CATEGORY_IN_USE,
          'Categoria em uso',
          `${emUso} ${emUso === 1 ? 'lançamento usa' : 'lançamentos usam'} esta categoria. Renomeie em vez de apagar.`,
        );
      }
      await repo.deleteCategory(tx, auth.organizationId, id);
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'finance.category_deleted',
        entityType: 'financial_category',
        entityId: id,
        metadata: { name: atual.name },
        ...client,
      });
    });
  }

  // ------------------------------ lançamentos ------------------------------

  async list(auth: AuthContext, query: FinancialListQuery): Promise<FinancialList> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const hoje = await hojeNaOficina(tx, auth.organizationId);
      const { rows, total } = await repo.listEntries(tx, auth.organizationId, query, hoje);
      const resumo = await repo.summary(tx, auth.organizationId, query.direction, hoje);
      const tz = await readTimezone(tx, auth.organizationId);
      const mes = periodRange('month', tz);
      const noMes =
        query.direction === 'RECEIVABLE'
          ? await repo.entradasNoPeriodo(tx, auth.organizationId, mes)
          : await repo.saidasNoPeriodo(tx, auth.organizationId, mes);

      return {
        data: rows.map((row) => toDto(row, hoje)),
        meta: { page: query.page, pageSize: query.pageSize, total },
        summary: {
          openCents: Number(resumo.open_cents),
          overdueCents: Number(resumo.overdue_cents),
          overdueCount: resumo.overdue_count,
          dueTodayCents: Number(resumo.due_today_cents),
          dueThisWeekCents: Number(resumo.due_week_cents),
          settledThisMonthCents: noMes,
        },
      };
    });
  }

  async get(auth: AuthContext, id: string): Promise<FinancialEntryDetail> {
    return withTenant(this.deps.db, auth, async (tx) => this.carregar(tx, auth, id));
  }

  /**
   * Lançamento manual. Com `installments > 1` nasce o carnê inteiro de uma vez:
   * mensal a partir do vencimento, sem perder centavo.
   */
  async create(
    auth: AuthContext,
    input: CreateFinancialEntryInput,
    client: ClientInfo,
  ): Promise<{ data: FinancialEntry[] }> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const categoria = await repo.findCategory(tx, auth.organizationId, input.categoryId);
      if (!categoria) throw notFound('Categoria não encontrada.');
      if (categoria.direction !== input.direction) {
        throw new AppError(
          422,
          ErrorCode.VALIDATION_FAILED,
          'Categoria de outra lista',
          'Esta categoria é da outra direção (a receber × a pagar).',
          [{ path: 'body.categoryId', message: 'Escolha uma categoria desta lista' }],
        );
      }
      if (input.customerId && !(await repo.customerExists(tx, auth.organizationId, input.customerId))) {
        throw notFound('Cliente não encontrado.');
      }
      if (input.supplierId && !(await repo.supplierExists(tx, auth.organizationId, input.supplierId))) {
        throw notFound('Fornecedor não encontrado.');
      }
      if (input.installments > 1 && input.amountCents < input.installments) {
        throw new AppError(
          422,
          ErrorCode.VALIDATION_FAILED,
          'Parcelas demais',
          'O valor não dá nem um centavo por parcela.',
          [{ path: 'body.installments', message: 'Reduza o número de parcelas' }],
        );
      }

      const valores = dividirEmParcelas(input.amountCents, input.installments);
      const vencimentos = vencimentosMensais(input.dueDate, input.installments);
      const groupId = input.installments > 1 ? uuidv7() : null;
      const criados = await repo.insertEntries(
        tx,
        valores.map((valor, index) => ({
          organizationId: auth.organizationId,
          direction: input.direction,
          origin: 'MANUAL' as const,
          categoryId: input.categoryId,
          description: input.description,
          amountCents: valor,
          dueDate: vencimentos[index]!,
          customerId: input.customerId,
          supplierId: input.supplierId,
          notes: blankToNull(input.notes) ?? null,
          groupId,
          installmentNumber: index + 1,
          installmentCount: input.installments,
          createdBy: auth.userId,
        })),
      );

      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'finance.entry_created',
        entityType: 'financial_entry',
        entityId: criados[0]!.id,
        metadata: {
          direction: input.direction,
          amountCents: input.amountCents,
          installments: input.installments,
          description: input.description,
        },
        ...client,
      });

      const hoje = await hojeNaOficina(tx, auth.organizationId);
      const detalhados = [];
      for (const criado of criados) {
        const row = await repo.findEntry(tx, auth.organizationId, criado.id);
        if (row) detalhados.push(toDto(row, hoje));
      }
      return { data: detalhados };
    });
  }

  async update(
    auth: AuthContext,
    id: string,
    input: UpdateFinancialEntryInput,
    client: ClientInfo,
  ): Promise<FinancialEntryDetail> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const atual = await repo.lockEntry(tx, auth.organizationId, id);
      if (!atual) throw notFound('Lançamento não encontrado.');
      if (atual.status === 'CANCELED') {
        throw new AppError(
          422,
          ErrorCode.FINANCE_ENTRY_STATE,
          'Lançamento cancelado',
          'Um lançamento cancelado não muda mais.',
        );
      }
      if (input.amountCents !== undefined && input.amountCents !== atual.amountCents) {
        if (atual.origin === 'WORK_ORDER') {
          throw new AppError(
            422,
            ErrorCode.FINANCE_ENTRY_MIRRORED,
            'Valor vem da OS',
            'Esta conta espelha a ordem de serviço: mude o valor na OS e ele chega aqui.',
          );
        }
        if (input.amountCents < atual.paidCents) {
          throw new AppError(
            422,
            ErrorCode.FINANCE_EXCEEDS_BALANCE,
            'Valor abaixo do que já foi baixado',
            `Já há ${formatBRL(atual.paidCents)} baixado neste lançamento.`,
            [{ path: 'body.amountCents', message: `O mínimo é ${formatBRL(atual.paidCents)}` }],
          );
        }
      }
      if (input.categoryId) {
        const categoria = await repo.findCategory(tx, auth.organizationId, input.categoryId);
        if (!categoria) throw notFound('Categoria não encontrada.');
        if (categoria.direction !== atual.direction) {
          throw new AppError(422, ErrorCode.VALIDATION_FAILED, 'Categoria de outra lista', 'Escolha uma categoria desta lista.');
        }
      }
      if (input.customerId && !(await repo.customerExists(tx, auth.organizationId, input.customerId))) {
        throw notFound('Cliente não encontrado.');
      }
      if (input.supplierId && !(await repo.supplierExists(tx, auth.organizationId, input.supplierId))) {
        throw notFound('Fornecedor não encontrado.');
      }

      const amountCents = input.amountCents ?? atual.amountCents;
      await repo.updateEntry(tx, id, {
        ...input,
        notes: input.notes === undefined ? undefined : (blankToNull(input.notes) ?? null),
        amountCents,
        status: statusDoLancamento(atual.paidCents, amountCents),
        version: atual.version + 1,
      });
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'finance.entry_updated',
        entityType: 'financial_entry',
        entityId: id,
        metadata: { description: input.description ?? atual.description },
        ...client,
      });
      return this.carregar(tx, auth, id);
    });
  }

  /** Cancelar não apaga: o lançamento fica no histórico, com motivo e autor. */
  async cancel(auth: AuthContext, id: string, reason: string, client: ClientInfo): Promise<FinancialEntryDetail> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const atual = await repo.lockEntry(tx, auth.organizationId, id);
      if (!atual) throw notFound('Lançamento não encontrado.');
      if (atual.status === 'CANCELED') {
        throw new AppError(409, ErrorCode.FINANCE_ENTRY_STATE, 'Já cancelado', 'Este lançamento já estava cancelado.');
      }
      if (atual.paidCents > 0) {
        throw new AppError(
          422,
          ErrorCode.FINANCE_ENTRY_STATE,
          'Lançamento com baixa',
          `Há ${formatBRL(atual.paidCents)} baixado aqui. Cancele a baixa antes de cancelar o lançamento.`,
        );
      }
      await repo.updateEntry(tx, id, {
        status: 'CANCELED',
        canceledAt: new Date(),
        canceledBy: auth.userId,
        cancelReason: reason.trim(),
        version: atual.version + 1,
      });
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'finance.entry_canceled',
        entityType: 'financial_entry',
        entityId: id,
        metadata: { description: atual.description, amountCents: atual.amountCents, reason: reason.trim() },
        ...client,
      });
      return this.carregar(tx, auth, id);
    });
  }

  /**
   * Parcelar: o "fiado" da oficina. O lançamento vira a parcela 1 e as outras
   * nascem mensais. Numa conta de OS a distribuição do que já foi pago é
   * refeita na hora — quem pagou um sinal vê a primeira parcela já quitada.
   */
  async split(
    auth: AuthContext,
    id: string,
    input: SplitFinancialEntryInput,
    client: ClientInfo,
  ): Promise<{ data: FinancialEntry[] }> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const atual = await repo.lockEntry(tx, auth.organizationId, id);
      if (!atual) throw notFound('Lançamento não encontrado.');
      if (atual.status === 'CANCELED' || atual.status === 'PAID') {
        throw new AppError(
          422,
          ErrorCode.FINANCE_ENTRY_STATE,
          'Não dá para parcelar',
          atual.status === 'PAID' ? 'Este lançamento já está quitado.' : 'Este lançamento está cancelado.',
        );
      }
      if (atual.installmentCount > 1) {
        throw new AppError(
          422,
          ErrorCode.FINANCE_ENTRY_STATE,
          'Já parcelado',
          'Este lançamento já faz parte de um parcelamento.',
        );
      }
      if (atual.paidCents > 0 && !atual.workOrderId) {
        throw new AppError(
          422,
          ErrorCode.FINANCE_ENTRY_STATE,
          'Lançamento com baixa',
          'Cancele a baixa antes de parcelar, ou crie os lançamentos do acordo novo.',
        );
      }
      if (atual.amountCents < input.installments) {
        throw new AppError(422, ErrorCode.VALIDATION_FAILED, 'Parcelas demais', 'O valor não dá nem um centavo por parcela.');
      }

      const valores = dividirEmParcelas(atual.amountCents, input.installments);
      const vencimentos = vencimentosMensais(input.firstDueDate ?? atual.dueDate, input.installments);
      const groupId = atual.groupId ?? uuidv7();

      await repo.updateEntry(tx, id, {
        amountCents: valores[0]!,
        dueDate: vencimentos[0]!,
        groupId,
        installmentNumber: 1,
        installmentCount: input.installments,
        paidCents: 0,
        status: 'OPEN',
        settledAt: null,
        version: atual.version + 1,
      });
      await repo.insertEntries(
        tx,
        valores.slice(1).map((valor, index) => ({
          organizationId: auth.organizationId,
          direction: atual.direction,
          origin: atual.origin,
          categoryId: atual.categoryId,
          description: atual.description,
          amountCents: valor,
          dueDate: vencimentos[index + 1]!,
          customerId: atual.customerId,
          supplierId: atual.supplierId,
          workOrderId: atual.workOrderId,
          purchaseOrderId: atual.purchaseOrderId,
          notes: atual.notes,
          groupId,
          installmentNumber: index + 2,
          installmentCount: input.installments,
          createdBy: auth.userId,
        })),
      );

      // conta de OS: o que já foi pago escorre de novo pelas parcelas
      if (atual.workOrderId) {
        const ordem = await repo.findEntry(tx, auth.organizationId, id);
        if (ordem?.entry.workOrderId) {
          await this.resyncWorkOrder(tx, auth.organizationId, ordem.entry.workOrderId);
        }
      }

      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'finance.entry_split',
        entityType: 'financial_entry',
        entityId: id,
        metadata: { installments: input.installments, amountCents: atual.amountCents },
        ...client,
      });

      const hoje = await hojeNaOficina(tx, auth.organizationId);
      const rows = await repo.listEntriesByGroup(tx, auth.organizationId, groupId);
      return { data: rows.map((row) => toDto(row, hoje)) };
    });
  }

  /**
   * A baixa. Numa conta de OS ela **é** o pagamento da OS (E7): o valor entra
   * em `payments`, a OS fica com o `payment_status` certo e as parcelas são
   * quitadas da mais velha para a mais nova. Nas outras contas, a baixa vive
   * em `financial_settlements`.
   */
  async settle(
    auth: AuthContext,
    id: string,
    input: SettleFinancialEntryInput,
    client: ClientInfo,
  ): Promise<FinancialEntryDetail> {
    const alvo = await withTenant(this.deps.db, auth, async (tx) => {
      const row = await repo.findEntry(tx, auth.organizationId, id);
      if (!row) throw notFound('Lançamento não encontrado.');
      return row.entry;
    });

    if (alvo.status === 'CANCELED') {
      throw new AppError(422, ErrorCode.FINANCE_ENTRY_STATE, 'Lançamento cancelado', 'Não dá para baixar um lançamento cancelado.');
    }
    const falta = faltaCents(alvo);
    if (falta === 0) {
      throw new AppError(422, ErrorCode.FINANCE_ENTRY_STATE, 'Lançamento quitado', 'Este lançamento já está quitado.');
    }
    if (input.amountCents > falta) {
      throw new AppError(
        422,
        ErrorCode.FINANCE_EXCEEDS_BALANCE,
        'Valor acima do que falta',
        `Falta ${formatBRL(falta)} neste lançamento.`,
        [{ path: 'body.amountCents', message: `O máximo é ${formatBRL(falta)}` }],
      );
    }

    // conta de OS: quem guarda o dinheiro é o caixa da OS, numa transação dele
    if (alvo.workOrderId) {
      await this.payments.record(
        auth,
        alvo.workOrderId,
        {
          method: input.method,
          amountCents: input.amountCents,
          installments: 1,
          paidAt: input.paidAt,
          notes: input.notes,
          clientRequestId: input.clientRequestId,
        },
        client,
      );
      return this.get(auth, id);
    }

    return withTenant(this.deps.db, auth, async (tx) => {
      const entry = await repo.lockEntry(tx, auth.organizationId, id);
      if (!entry) throw notFound('Lançamento não encontrado.');

      // clique duplo, ou rede que repete o POST: a segunda chamada não baixa de novo
      const repetida = await repo.findSettlementByRequest(tx, auth.organizationId, input.clientRequestId);
      if (repetida) return this.carregar(tx, auth, id);

      const jaPago = await repo.sumConfirmedSettlements(tx, auth.organizationId, id);
      if (jaPago + input.amountCents > entry.amountCents) {
        throw new AppError(
          422,
          ErrorCode.FINANCE_EXCEEDS_BALANCE,
          'Valor acima do que falta',
          `Falta ${formatBRL(Math.max(0, entry.amountCents - jaPago))} neste lançamento.`,
        );
      }

      const baixa = await repo.insertSettlement(tx, {
        organizationId: auth.organizationId,
        entryId: id,
        clientRequestId: input.clientRequestId,
        amountCents: input.amountCents,
        method: input.method,
        paidAt: input.paidAt ? new Date(input.paidAt) : new Date(),
        notes: blankToNull(input.notes) ?? null,
        createdBy: auth.userId,
      });
      await this.recalcular(tx, auth.organizationId, id);

      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'finance.settled',
        entityType: 'financial_entry',
        entityId: id,
        metadata: {
          direction: entry.direction,
          amountCents: input.amountCents,
          method: input.method,
          settlementId: baixa.id,
        },
        ...client,
      });
      return this.carregar(tx, auth, id);
    });
  }

  /** Erro de digitação não se apaga: a baixa vira cancelada, com motivo. */
  async cancelSettlement(
    auth: AuthContext,
    settlementId: string,
    reason: string,
    client: ClientInfo,
  ): Promise<FinancialEntryDetail> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const baixa = await repo.lockSettlement(tx, auth.organizationId, settlementId);
      if (!baixa) throw notFound('Baixa não encontrada.');
      if (baixa.status === 'CANCELED') {
        throw new AppError(409, ErrorCode.FINANCE_ENTRY_STATE, 'Baixa já cancelada', 'Esta baixa já estava cancelada.');
      }
      await repo.lockEntry(tx, auth.organizationId, baixa.entryId);
      await repo.updateSettlement(tx, settlementId, {
        status: 'CANCELED',
        canceledAt: new Date(),
        canceledBy: auth.userId,
        cancelReason: reason.trim(),
      });
      await this.recalcular(tx, auth.organizationId, baixa.entryId);
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'finance.settlement_canceled',
        entityType: 'financial_entry',
        entityId: baixa.entryId,
        metadata: { amountCents: baixa.amountCents, reason: reason.trim() },
        ...client,
      });
      return this.carregar(tx, auth, baixa.entryId);
    });
  }

  // ------------------------------- relatórios -------------------------------

  /**
   * O caixa do período: o que entrou, o que saiu e o acumulado, no relógio da
   * oficina. Junto vai o **previsto** — o que ainda vence no período — porque a
   * pergunta do dono não é só "quanto entrou", é "vou conseguir pagar".
   */
  async cashFlow(auth: AuthContext, query: FinancialPeriodQuery): Promise<CashFlow> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const tz = await readTimezone(tx, auth.organizationId);
      const janela = periodRange(query.period, tz, { from: query.from, to: query.to });
      const diario = await repo.movimentoDiario(tx, auth.organizationId, janela, tz);
      const previsto = await repo.previstoNoPeriodo(tx, auth.organizationId, janela.fromDay, janela.toDay);

      const porDia = new Map(diario.map((row) => [row.day, row]));
      const baldes = new Map<string, CashFlowBucket>();
      for (const dia of daysBetween(janela.fromDay, janela.toDay)) {
        const chave = query.step === 'day' ? dia : query.step === 'week' ? startOfWeek(dia) : startOfMonth(dia);
        const atual = baldes.get(chave) ?? {
          key: chave,
          label: rotuloDoBalde(chave, query.step),
          inCents: 0,
          outCents: 0,
          netCents: 0,
          runningCents: 0,
        };
        const movimento = porDia.get(dia);
        atual.inCents += Number(movimento?.in_cents ?? 0);
        atual.outCents += Number(movimento?.out_cents ?? 0);
        atual.netCents = atual.inCents - atual.outCents;
        baldes.set(chave, atual);
      }

      let acumulado = 0;
      const buckets = [...baldes.values()].map((balde) => {
        acumulado += balde.netCents;
        return { ...balde, runningCents: acumulado };
      });
      const inCents = buckets.reduce((soma, b) => soma + b.inCents, 0);
      const outCents = buckets.reduce((soma, b) => soma + b.outCents, 0);

      return {
        from: janela.fromDay,
        to: janela.toDay,
        step: query.step,
        buckets,
        inCents,
        outCents,
        netCents: inCents - outCents,
        expectedInCents: previsto.inCents,
        expectedOutCents: previsto.outCents,
      };
    });
  }

  /** Lucro ESTIMADO: receita faturada − custo das peças usadas − despesas pagas. */
  async profit(auth: AuthContext, query: FinancialPeriodQuery): Promise<ProfitReport> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const tz = await readTimezone(tx, auth.organizationId);
      const janela = periodRange(query.period, tz, { from: query.from, to: query.to });
      const receitaCents = await repo.receitaNoPeriodo(tx, auth.organizationId, janela);
      const custoPecasCents = await repo.custoDasPecasNoPeriodo(tx, auth.organizationId, janela);
      const categorias = await repo.despesasPorCategoria(tx, auth.organizationId, janela);
      // "Peças" fica de fora da despesa: já entrou pelo custo da peça usada
      const despesasCents = categorias
        .filter((linha) => linha.system_key !== 'PARTS')
        .reduce((soma, linha) => soma + Number(linha.total), 0);

      return {
        from: janela.fromDay,
        to: janela.toDay,
        ...lucroEstimado({ receitaCents, custoPecasCents, despesasCents }),
        despesasPorCategoria: categorias.map((linha) => ({ name: linha.name, amountCents: Number(linha.total) })),
      };
    });
  }

  // -------------------------------- internos --------------------------------

  /** Redistribui o que foi pago entre as parcelas de uma OS. */
  private async resyncWorkOrder(tx: Tx, organizationId: string, workOrderId: string): Promise<void> {
    const [order] = await tx
      .select({
        id: workOrders.id,
        number: workOrders.number,
        customerId: workOrders.customerId,
        approvedTotalCents: workOrders.approvedTotalCents,
        totalCents: workOrders.totalCents,
        status: workOrders.status,
      })
      .from(workOrders)
      .where(and(eq(workOrders.organizationId, organizationId), eq(workOrders.id, workOrderId)))
      .limit(1);
    if (order) await syncWorkOrderEntries(tx, organizationId, order);
  }

  /** `paid_cents` sai SEMPRE da soma das baixas confirmadas. */
  private async recalcular(tx: Tx, organizationId: string, entryId: string): Promise<void> {
    const entry = await repo.lockEntry(tx, organizationId, entryId);
    if (!entry) return;
    const pago = await repo.sumConfirmedSettlements(tx, organizationId, entryId);
    const status = statusDoLancamento(pago, entry.amountCents);
    await repo.updateEntry(tx, entryId, {
      paidCents: pago,
      status,
      settledAt: status === 'PAID' ? (entry.settledAt ?? new Date()) : null,
    });
  }

  private async carregar(tx: Tx, auth: AuthContext, id: string): Promise<FinancialEntryDetail> {
    const row = await repo.findEntry(tx, auth.organizationId, id);
    if (!row) throw notFound('Lançamento não encontrado.');
    const hoje = await hojeNaOficina(tx, auth.organizationId);
    return { ...toDto(row, hoje), settlements: await this.baixas(tx, auth.organizationId, row) };
  }

  /**
   * As baixas do lançamento. Numa conta de OS elas SÃO os pagamentos da OS —
   * mostrar uma lista paralela faria a oficina procurar um dinheiro que já
   * está no caixa.
   */
  private async baixas(
    tx: Tx,
    organizationId: string,
    row: repo.FinancialEntryJoined,
  ): Promise<FinancialSettlement[]> {
    if (row.entry.workOrderId) {
      const pagamentos = await repo.listWorkOrderPayments(tx, organizationId, row.entry.workOrderId);
      return pagamentos.map(({ payment, recordedByName }) => ({
        id: payment.id,
        amountCents: payment.amountCents,
        method: payment.method,
        paidAt: payment.paidAt.toISOString(),
        notes: payment.notes,
        status: payment.status,
        canceledAt: payment.canceledAt?.toISOString() ?? null,
        cancelReason: payment.cancelReason,
        recordedByName,
        paymentId: payment.id,
      }));
    }
    const baixas = await repo.listSettlements(tx, organizationId, row.entry.id);
    return baixas.map(({ settlement, recordedByName }) => ({
      id: settlement.id,
      amountCents: settlement.amountCents,
      method: settlement.method,
      paidAt: settlement.paidAt.toISOString(),
      notes: settlement.notes,
      status: settlement.status,
      canceledAt: settlement.canceledAt?.toISOString() ?? null,
      cancelReason: settlement.cancelReason,
      recordedByName,
      paymentId: settlement.paymentId,
    }));
  }
}

const categoriaDto = (row: { category: repo.FinancialCategoryRow; entryCount: number }): FinancialCategory => ({
  id: row.category.id,
  name: row.category.name,
  direction: row.category.direction,
  systemKey: row.category.systemKey,
  entryCount: row.entryCount,
});

/** "18/09", "semana de 14/09", "set/2026" — como a oficina lê o eixo do gráfico. */
function rotuloDoBalde(key: string, step: FinancialPeriodQuery['step']): string {
  if (step === 'day') return diaEMes(key);
  if (step === 'week') return `semana de ${diaEMes(key)}`;
  return `${MESES_CURTOS[Number(key.slice(5, 7)) - 1]}/${key.slice(0, 4)}`;
}
