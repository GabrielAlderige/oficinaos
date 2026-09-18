import { and, asc, count, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { FinancialDirection, FinancialListQuery } from '@oficinaos/shared';
import { likeContains } from '../../core/normalize';
import {
  customers,
  financialCategories,
  financialEntries,
  financialSettlements,
  payments,
  purchaseOrders,
  suppliers,
  users,
  workOrders,
} from '../../db/schema';
import type { Tx } from '../../db/tenant';

export type FinancialEntryRow = typeof financialEntries.$inferSelect;
export type FinancialCategoryRow = typeof financialCategories.$inferSelect;
export type FinancialSettlementRow = typeof financialSettlements.$inferSelect;

const recorder = alias(users, 'settlement_recorded_by');

/** Situações que ainda esperam dinheiro. */
const ABERTAS = ['OPEN', 'PARTIAL'] as const;

// ------------------------------- categorias -------------------------------

/**
 * Quantos lançamentos usam a categoria: a tela só oferece apagar o que não
 * está em uso. A subconsulta escreve `financial_categories.id` por extenso —
 * em consulta de uma tabela só, o Drizzle renderiza `${tabela.coluna}` sem
 * qualificar e o `id` viraria o do lançamento (armadilha da E3).
 */
const entryCount = sql<number>`(
  select count(*)::int from financial_entries e
  where e.organization_id = financial_categories.organization_id
    and e.category_id = financial_categories.id
)`;

export async function listCategories(tx: Tx, organizationId: string, direction?: FinancialDirection) {
  return tx
    .select({ category: financialCategories, entryCount })
    .from(financialCategories)
    .where(
      and(
        eq(financialCategories.organizationId, organizationId),
        direction ? eq(financialCategories.direction, direction) : undefined,
      ),
    )
    .orderBy(asc(financialCategories.direction), asc(financialCategories.name));
}

export async function findCategory(tx: Tx, organizationId: string, id: string) {
  const [row] = await tx
    .select()
    .from(financialCategories)
    .where(and(eq(financialCategories.organizationId, organizationId), eq(financialCategories.id, id)))
    .limit(1);
  return row;
}

export async function findCategoryByKey(tx: Tx, organizationId: string, systemKey: string) {
  const [row] = await tx
    .select()
    .from(financialCategories)
    .where(and(eq(financialCategories.organizationId, organizationId), eq(financialCategories.systemKey, systemKey)))
    .limit(1);
  return row;
}

export async function insertCategory(tx: Tx, values: typeof financialCategories.$inferInsert) {
  const [row] = await tx.insert(financialCategories).values(values).returning();
  return row!;
}

export async function updateCategory(tx: Tx, id: string, patch: Partial<typeof financialCategories.$inferInsert>) {
  const [row] = await tx.update(financialCategories).set(patch).where(eq(financialCategories.id, id)).returning();
  return row!;
}

export async function deleteCategory(tx: Tx, organizationId: string, id: string) {
  await tx
    .delete(financialCategories)
    .where(and(eq(financialCategories.organizationId, organizationId), eq(financialCategories.id, id)));
}

/** As nove categorias do sistema nascem com a oficina (as antigas ganham na migration 0028). */
export async function insertDefaultCategories(
  tx: Tx,
  organizationId: string,
  padroes: readonly { key: string; direction: FinancialDirection; name: string }[],
) {
  await tx
    .insert(financialCategories)
    .values(padroes.map((c) => ({ organizationId, direction: c.direction, name: c.name, systemKey: c.key })))
    .onConflictDoNothing();
}

// ------------------------------- lançamentos -------------------------------

const joined = (tx: Tx) =>
  tx
    .select({
      entry: financialEntries,
      categoryName: financialCategories.name,
      categorySystemKey: financialCategories.systemKey,
      customerName: customers.name,
      supplierName: suppliers.name,
      workOrderNumber: workOrders.number,
      purchaseOrderNumber: purchaseOrders.number,
    })
    .from(financialEntries)
    .leftJoin(
      financialCategories,
      and(
        eq(financialCategories.organizationId, financialEntries.organizationId),
        eq(financialCategories.id, financialEntries.categoryId),
      ),
    )
    .leftJoin(
      customers,
      and(eq(customers.organizationId, financialEntries.organizationId), eq(customers.id, financialEntries.customerId)),
    )
    .leftJoin(
      suppliers,
      and(eq(suppliers.organizationId, financialEntries.organizationId), eq(suppliers.id, financialEntries.supplierId)),
    )
    .leftJoin(
      workOrders,
      and(
        eq(workOrders.organizationId, financialEntries.organizationId),
        eq(workOrders.id, financialEntries.workOrderId),
      ),
    )
    .leftJoin(
      purchaseOrders,
      and(
        eq(purchaseOrders.organizationId, financialEntries.organizationId),
        eq(purchaseOrders.id, financialEntries.purchaseOrderId),
      ),
    );

/** A linha da lista com os nomes já resolvidos (escrita à mão: o tipo inferido do join é ilegível). */
export interface FinancialEntryJoined {
  entry: FinancialEntryRow;
  categoryName: string | null;
  categorySystemKey: string | null;
  customerName: string | null;
  supplierName: string | null;
  workOrderNumber: number | null;
  purchaseOrderNumber: number | null;
}

/** O filtro da tela vira condição SQL. "Vencida" é hoje comparado ao vencimento. */
function filtroSituacao(filter: FinancialListQuery['filter'], hoje: string): SQL | undefined {
  switch (filter) {
    case 'open':
      return inArray(financialEntries.status, [...ABERTAS]);
    case 'overdue':
      return and(inArray(financialEntries.status, [...ABERTAS]), sql`${financialEntries.dueDate} < ${hoje}`);
    case 'due_soon':
      return and(
        inArray(financialEntries.status, [...ABERTAS]),
        sql`${financialEntries.dueDate} >= ${hoje}`,
        sql`${financialEntries.dueDate} < (${hoje}::date + 7)`,
      );
    case 'paid':
      return eq(financialEntries.status, 'PAID');
    case 'canceled':
      return eq(financialEntries.status, 'CANCELED');
    case 'all':
      return undefined;
  }
}

export async function listEntries(
  tx: Tx,
  organizationId: string,
  query: FinancialListQuery,
  hoje: string,
): Promise<{ rows: FinancialEntryJoined[]; total: number }> {
  const texto = query.q ? likeContains(query.q) : null;
  const numero = query.q && /^\d+$/.test(query.q.trim()) ? Number(query.q.trim()) : null;
  const where = and(
    eq(financialEntries.organizationId, organizationId),
    eq(financialEntries.direction, query.direction),
    filtroSituacao(query.filter, hoje),
    query.categoryId ? eq(financialEntries.categoryId, query.categoryId) : undefined,
    query.customerId ? eq(financialEntries.customerId, query.customerId) : undefined,
    query.supplierId ? eq(financialEntries.supplierId, query.supplierId) : undefined,
    query.from ? sql`${financialEntries.dueDate} >= ${query.from}` : undefined,
    query.to ? sql`${financialEntries.dueDate} <= ${query.to}` : undefined,
    texto
      ? or(
          sql`immutable_unaccent(${financialEntries.description}) ilike immutable_unaccent(${texto})`,
          sql`immutable_unaccent(coalesce(customers.name, '')) ilike immutable_unaccent(${texto})`,
          sql`immutable_unaccent(coalesce(suppliers.name, '')) ilike immutable_unaccent(${texto})`,
          ...(numero !== null
            ? [sql`work_orders.number = ${numero}`, sql`purchase_orders.number = ${numero}`]
            : []),
        )
      : undefined,
  );

  // em aberto: o mais urgente primeiro. Fechadas: a mais recente primeiro.
  const ordem =
    query.filter === 'paid' || query.filter === 'canceled'
      ? [desc(financialEntries.dueDate), desc(financialEntries.createdAt)]
      : [asc(financialEntries.dueDate), asc(financialEntries.createdAt)];

  const rows = await joined(tx)
    .where(where)
    .orderBy(...ordem)
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);

  // a contagem repete os joins porque a busca filtra por nome de cliente e fornecedor
  const [total] = await tx
    .select({ total: count() })
    .from(financialEntries)
    .leftJoin(
      customers,
      and(eq(customers.organizationId, financialEntries.organizationId), eq(customers.id, financialEntries.customerId)),
    )
    .leftJoin(
      suppliers,
      and(eq(suppliers.organizationId, financialEntries.organizationId), eq(suppliers.id, financialEntries.supplierId)),
    )
    .leftJoin(
      workOrders,
      and(eq(workOrders.organizationId, financialEntries.organizationId), eq(workOrders.id, financialEntries.workOrderId)),
    )
    .leftJoin(
      purchaseOrders,
      and(
        eq(purchaseOrders.organizationId, financialEntries.organizationId),
        eq(purchaseOrders.id, financialEntries.purchaseOrderId),
      ),
    )
    .where(where);

  return { rows, total: total?.total ?? 0 };
}

export async function findEntry(tx: Tx, organizationId: string, id: string) {
  const [row] = await joined(tx)
    .where(and(eq(financialEntries.organizationId, organizationId), eq(financialEntries.id, id)))
    .limit(1);
  return row;
}

/** Trava o lançamento: duas baixas simultâneas não furam o saldo. */
export async function lockEntry(tx: Tx, organizationId: string, id: string) {
  const [row] = await tx
    .select()
    .from(financialEntries)
    .where(and(eq(financialEntries.organizationId, organizationId), eq(financialEntries.id, id)))
    .limit(1)
    .for('update');
  return row;
}

export async function insertEntries(tx: Tx, values: (typeof financialEntries.$inferInsert)[]) {
  if (!values.length) return [];
  return tx.insert(financialEntries).values(values).returning();
}

export async function updateEntry(tx: Tx, id: string, patch: Partial<typeof financialEntries.$inferInsert>) {
  const [row] = await tx.update(financialEntries).set(patch).where(eq(financialEntries.id, id)).returning();
  return row!;
}

/** As parcelas vivas de uma OS, na ordem de vencimento — e travadas. */
export async function lockEntriesOfWorkOrder(tx: Tx, organizationId: string, workOrderId: string) {
  return tx
    .select()
    .from(financialEntries)
    .where(
      and(
        eq(financialEntries.organizationId, organizationId),
        eq(financialEntries.workOrderId, workOrderId),
        sql`${financialEntries.status} <> 'CANCELED'`,
      ),
    )
    .orderBy(asc(financialEntries.installmentNumber), asc(financialEntries.dueDate), asc(financialEntries.createdAt))
    .for('update');
}

export async function listEntriesOfPurchaseOrder(tx: Tx, organizationId: string, purchaseOrderId: string) {
  return tx
    .select()
    .from(financialEntries)
    .where(
      and(
        eq(financialEntries.organizationId, organizationId),
        eq(financialEntries.purchaseOrderId, purchaseOrderId),
        sql`${financialEntries.status} <> 'CANCELED'`,
      ),
    )
    .orderBy(desc(financialEntries.createdAt))
    .for('update');
}

export async function entriesOfWorkOrders(tx: Tx, organizationId: string, workOrderIds: string[]) {
  if (!workOrderIds.length) return [];
  return tx
    .select()
    .from(financialEntries)
    .where(
      and(
        eq(financialEntries.organizationId, organizationId),
        inArray(financialEntries.workOrderId, workOrderIds),
        sql`${financialEntries.status} <> 'CANCELED'`,
      ),
    );
}

// --------------------------------- baixas ---------------------------------

export async function insertSettlement(tx: Tx, values: typeof financialSettlements.$inferInsert) {
  const [row] = await tx.insert(financialSettlements).values(values).returning();
  return row!;
}

export async function findSettlementByRequest(tx: Tx, organizationId: string, clientRequestId: string) {
  const [row] = await tx
    .select()
    .from(financialSettlements)
    .where(
      and(
        eq(financialSettlements.organizationId, organizationId),
        eq(financialSettlements.clientRequestId, clientRequestId),
      ),
    )
    .limit(1);
  return row;
}

export async function lockSettlement(tx: Tx, organizationId: string, id: string) {
  const [row] = await tx
    .select()
    .from(financialSettlements)
    .where(and(eq(financialSettlements.organizationId, organizationId), eq(financialSettlements.id, id)))
    .limit(1)
    .for('update');
  return row;
}

export async function updateSettlement(tx: Tx, id: string, patch: Partial<typeof financialSettlements.$inferInsert>) {
  const [row] = await tx.update(financialSettlements).set(patch).where(eq(financialSettlements.id, id)).returning();
  return row!;
}

export async function listSettlements(tx: Tx, organizationId: string, entryId: string) {
  return tx
    .select({ settlement: financialSettlements, recordedByName: recorder.name })
    .from(financialSettlements)
    .leftJoin(recorder, eq(recorder.id, financialSettlements.createdBy))
    .where(and(eq(financialSettlements.organizationId, organizationId), eq(financialSettlements.entryId, entryId)))
    .orderBy(desc(financialSettlements.paidAt));
}

/** Soma das baixas confirmadas: a ÚNICA fonte de `paid_cents` fora das OS. */
export async function sumConfirmedSettlements(tx: Tx, organizationId: string, entryId: string): Promise<number> {
  const [row] = await tx
    .select({ total: sql<string>`coalesce(sum(${financialSettlements.amountCents}), 0)` })
    .from(financialSettlements)
    .where(
      and(
        eq(financialSettlements.organizationId, organizationId),
        eq(financialSettlements.entryId, entryId),
        eq(financialSettlements.status, 'CONFIRMED'),
      ),
    );
  return Number(row?.total ?? 0);
}

/** Os pagamentos da OS viram as "baixas" do lançamento dela (a verdade do caixa é `payments`). */
export async function listWorkOrderPayments(tx: Tx, organizationId: string, workOrderId: string) {
  return tx
    .select({ payment: payments, recordedByName: recorder.name })
    .from(payments)
    .leftJoin(recorder, eq(recorder.id, payments.createdBy))
    .where(and(eq(payments.organizationId, organizationId), eq(payments.workOrderId, workOrderId)))
    .orderBy(desc(payments.paidAt));
}

export async function findPaymentByRequest(tx: Tx, organizationId: string, clientRequestId: string) {
  const [row] = await tx
    .select()
    .from(payments)
    .where(and(eq(payments.organizationId, organizationId), eq(payments.clientRequestId, clientRequestId)))
    .limit(1);
  return row;
}

// --------------------------------- resumos ---------------------------------

export interface ResumoFinanceiro extends Record<string, unknown> {
  open_cents: string;
  overdue_cents: string;
  overdue_count: number;
  due_today_cents: string;
  due_week_cents: string;
}

/** O topo da lista: o que está em aberto, o que venceu e o que vence na semana. */
export async function summary(
  tx: Tx,
  organizationId: string,
  direction: FinancialDirection,
  hoje: string,
): Promise<ResumoFinanceiro> {
  const { rows } = await tx.execute<ResumoFinanceiro>(sql`
    select coalesce(sum(amount_cents - paid_cents), 0)::bigint as open_cents,
           coalesce(sum(amount_cents - paid_cents) filter (where due_date < ${hoje}), 0)::bigint as overdue_cents,
           (count(*) filter (where due_date < ${hoje}))::int as overdue_count,
           coalesce(sum(amount_cents - paid_cents) filter (where due_date = ${hoje}), 0)::bigint as due_today_cents,
           coalesce(sum(amount_cents - paid_cents)
                    filter (where due_date >= ${hoje} and due_date < (${hoje}::date + 7)), 0)::bigint as due_week_cents
    from financial_entries
    where organization_id = ${organizationId}
      and direction = ${direction}
      and status in ('OPEN', 'PARTIAL')
  `);
  return rows[0] ?? { open_cents: '0', overdue_cents: '0', overdue_count: 0, due_today_cents: '0', due_week_cents: '0' };
}

export interface Janela {
  from: Date;
  to: Date;
}

/**
 * Dinheiro que ENTROU: os pagamentos das OS (a verdade do caixa, E7) mais as
 * baixas de contas a receber avulsas. Um lançamento de OS nunca tem baixa
 * própria, então nada é contado duas vezes.
 */
export async function entradasNoPeriodo(tx: Tx, organizationId: string, janela: Janela): Promise<number> {
  const { rows } = await tx.execute<{ total: string }>(sql`
    select (
      coalesce((select sum(amount_cents) from payments
                where organization_id = ${organizationId} and status = 'CONFIRMED'
                  and paid_at >= ${janela.from} and paid_at < ${janela.to}), 0)
      + coalesce((select sum(s.amount_cents) from financial_settlements s
                  join financial_entries e on e.organization_id = s.organization_id and e.id = s.entry_id
                  where s.organization_id = ${organizationId} and s.status = 'CONFIRMED'
                    and e.direction = 'RECEIVABLE'
                    and s.paid_at >= ${janela.from} and s.paid_at < ${janela.to}), 0)
    )::bigint as total
  `);
  return Number(rows[0]?.total ?? 0);
}

/** Dinheiro que SAIU: baixas de contas a pagar. */
export async function saidasNoPeriodo(tx: Tx, organizationId: string, janela: Janela): Promise<number> {
  const { rows } = await tx.execute<{ total: string }>(sql`
    select coalesce(sum(s.amount_cents), 0)::bigint as total
    from financial_settlements s
    join financial_entries e on e.organization_id = s.organization_id and e.id = s.entry_id
    where s.organization_id = ${organizationId} and s.status = 'CONFIRMED'
      and e.direction = 'PAYABLE'
      and s.paid_at >= ${janela.from} and s.paid_at < ${janela.to}
  `);
  return Number(rows[0]?.total ?? 0);
}

export interface MovimentoDoDia extends Record<string, unknown> {
  day: string;
  in_cents: string;
  out_cents: string;
}

/**
 * O caixa dia a dia, no relógio da OFICINA: a conversão para o fuso acontece no
 * banco (`at time zone`), senão um Pix das 22 h de Manaus cairia no dia seguinte.
 */
export async function movimentoDiario(
  tx: Tx,
  organizationId: string,
  janela: Janela,
  timeZone: string,
): Promise<MovimentoDoDia[]> {
  const { rows } = await tx.execute<MovimentoDoDia>(sql`
    with movimento as (
      select p.paid_at, p.amount_cents, 'IN' as flow
      from payments p
      where p.organization_id = ${organizationId} and p.status = 'CONFIRMED'
        and p.paid_at >= ${janela.from} and p.paid_at < ${janela.to}
      union all
      select s.paid_at, s.amount_cents, case when e.direction = 'RECEIVABLE' then 'IN' else 'OUT' end as flow
      from financial_settlements s
      join financial_entries e on e.organization_id = s.organization_id and e.id = s.entry_id
      where s.organization_id = ${organizationId} and s.status = 'CONFIRMED'
        and s.paid_at >= ${janela.from} and s.paid_at < ${janela.to}
    )
    select to_char((paid_at at time zone ${timeZone})::date, 'YYYY-MM-DD') as day,
           coalesce(sum(amount_cents) filter (where flow = 'IN'), 0)::bigint as in_cents,
           coalesce(sum(amount_cents) filter (where flow = 'OUT'), 0)::bigint as out_cents
    from movimento
    group by 1
    order by 1
  `);
  return rows;
}

/** O que ainda vai entrar e sair no período: o que está em aberto vencendo nele. */
export async function previstoNoPeriodo(
  tx: Tx,
  organizationId: string,
  fromDay: string,
  toDay: string,
): Promise<{ inCents: number; outCents: number }> {
  const { rows } = await tx.execute<{ in_cents: string; out_cents: string }>(sql`
    select coalesce(sum(amount_cents - paid_cents) filter (where direction = 'RECEIVABLE'), 0)::bigint as in_cents,
           coalesce(sum(amount_cents - paid_cents) filter (where direction = 'PAYABLE'), 0)::bigint as out_cents
    from financial_entries
    where organization_id = ${organizationId}
      and status in ('OPEN', 'PARTIAL')
      and due_date >= ${fromDay} and due_date <= ${toDay}
  `);
  return { inCents: Number(rows[0]?.in_cents ?? 0), outCents: Number(rows[0]?.out_cents ?? 0) };
}

/** Receita faturada: a mesma regra do `devidoCents` usada pelo dashboard. */
export async function receitaNoPeriodo(tx: Tx, organizationId: string, janela: Janela): Promise<number> {
  const { rows } = await tx.execute<{ total: string }>(sql`
    select coalesce(sum(case when approved_total_cents > 0 then approved_total_cents else total_cents end), 0)::bigint as total
    from work_orders
    where organization_id = ${organizationId}
      and status <> 'CANCELED'
      and completed_at >= ${janela.from} and completed_at < ${janela.to}
  `);
  return Number(rows[0]?.total ?? 0);
}

/**
 * Custo das peças que saíram em OS no período, pelo custo médio da hora da
 * baixa. `quantity` é a quantidade de verdade (numeric 12,3), não milésimos:
 * dividir por mil aqui fazia o custo das peças virar centavos — o gráfico do
 * lucro mostrou isso na primeira olhada.
 */
export async function custoDasPecasNoPeriodo(tx: Tx, organizationId: string, janela: Janela): Promise<number> {
  const { rows } = await tx.execute<{ total: string }>(sql`
    select coalesce(round(sum((-quantity) * coalesce(unit_cost_cents, 0))), 0)::bigint as total
    from inventory_movements
    where organization_id = ${organizationId}
      and type = 'WORK_ORDER_OUT'
      and created_at >= ${janela.from} and created_at < ${janela.to}
  `);
  return Number(rows[0]?.total ?? 0);
}

export interface DespesaPorCategoria extends Record<string, unknown> {
  name: string;
  system_key: string | null;
  total: string;
}

/** O que foi pago no período, por categoria. "Peças" vem marcada para o lucro estimado. */
export async function despesasPorCategoria(
  tx: Tx,
  organizationId: string,
  janela: Janela,
): Promise<DespesaPorCategoria[]> {
  const { rows } = await tx.execute<DespesaPorCategoria>(sql`
    select coalesce(c.name, 'Sem categoria') as name,
           c.system_key,
           sum(s.amount_cents)::bigint as total
    from financial_settlements s
    join financial_entries e on e.organization_id = s.organization_id and e.id = s.entry_id
    left join financial_categories c on c.organization_id = e.organization_id and c.id = e.category_id
    where s.organization_id = ${organizationId} and s.status = 'CONFIRMED'
      and e.direction = 'PAYABLE'
      and s.paid_at >= ${janela.from} and s.paid_at < ${janela.to}
    group by 1, 2
    order by 3 desc
  `);
  return rows;
}

/** Contas vencidas para o "Atenção necessária" do painel (E9). */
export async function vencidas(tx: Tx, organizationId: string, hoje: string) {
  const { rows } = await tx.execute<{ direction: string; total: string; quantidade: number }>(sql`
    select direction, coalesce(sum(amount_cents - paid_cents), 0)::bigint as total, count(*)::int as quantidade
    from financial_entries
    where organization_id = ${organizationId}
      and status in ('OPEN', 'PARTIAL')
      and due_date < ${hoje}
    group by direction
  `);
  return rows;
}

/** O cliente/fornecedor existe nesta oficina? (a FK composta já barraria; isto dá mensagem) */
export async function customerExists(tx: Tx, organizationId: string, id: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.organizationId, organizationId), eq(customers.id, id)))
    .limit(1);
  return Boolean(row);
}

export async function supplierExists(tx: Tx, organizationId: string, id: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(and(eq(suppliers.organizationId, organizationId), eq(suppliers.id, id)))
    .limit(1);
  return Boolean(row);
}

/** As parcelas de um mesmo acordo, na ordem do carnê. */
export async function listEntriesByGroup(tx: Tx, organizationId: string, groupId: string) {
  return joined(tx)
    .where(and(eq(financialEntries.organizationId, organizationId), eq(financialEntries.groupId, groupId)))
    .orderBy(asc(financialEntries.installmentNumber));
}
