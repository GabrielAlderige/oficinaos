import { sql } from 'drizzle-orm';
import type { Tx } from '../../db/tenant';

/**
 * Agregações do dashboard (docs/DATABASE.md §7). SQL cru aqui é mais legível que
 * o construtor: são contagens e somas com muitos `filter`, não navegação de
 * entidades.
 *
 * **O que a OS vale** é a mesma regra do `devidoCents` do shared: o que o
 * cliente aprovou, ou o total quando não houve orçamento. Escrita duas vezes —
 * aqui e lá — porque somar centavos no banco é a única forma de não puxar todas
 * as OS para a memória; há teste comparando as duas.
 */
const DEVIDO = sql`case when work_orders.approved_total_cents > 0
                        then work_orders.approved_total_cents
                        else work_orders.total_cents end`;

/** O carro ainda está na oficina. */
const NO_PATIO = sql`work_orders.status not in ('DELIVERED', 'CANCELED')`;

export interface Janela {
  from: Date;
  to: Date;
}

export interface ResumoDoPeriodo extends Record<string, unknown> {
  billed: string;
  orders: number;
  vehicles: number;
}

/** O que a oficina entregou de serviço no período: a base do "faturado". */
export async function finalizadasNoPeriodo(
  tx: Tx,
  organizationId: string,
  janela: Janela,
): Promise<ResumoDoPeriodo> {
  const { rows } = await tx.execute<ResumoDoPeriodo>(sql`
    select coalesce(sum(${DEVIDO}), 0)::bigint as billed,
           count(*)::int as orders,
           count(distinct work_orders.vehicle_id)::int as vehicles
    from work_orders
    where work_orders.organization_id = ${organizationId}
      and work_orders.status <> 'CANCELED'
      and work_orders.completed_at >= ${janela.from}
      and work_orders.completed_at < ${janela.to}
  `);
  return rows[0] ?? { billed: '0', orders: 0, vehicles: 0 };
}

/** Serviços concluídos: item de serviço das OS finalizadas, sem os recusados. */
export async function servicosConcluidos(tx: Tx, organizationId: string, janela: Janela): Promise<number> {
  const { rows } = await tx.execute<{ total: number }>(sql`
    select count(*)::int as total
    from work_order_items i
    join work_orders on work_orders.organization_id = i.organization_id and work_orders.id = i.work_order_id
    where i.organization_id = ${organizationId}
      and i.type = 'SERVICE'
      and i.approval_status <> 'REJECTED'
      and work_orders.status <> 'CANCELED'
      and work_orders.completed_at >= ${janela.from}
      and work_orders.completed_at < ${janela.to}
  `);
  return rows[0]?.total ?? 0;
}

/** Dinheiro que entrou no período: lançamentos confirmados, nada mais. */
export async function recebidoNoPeriodo(tx: Tx, organizationId: string, janela: Janela): Promise<number> {
  const { rows } = await tx.execute<{ total: string }>(sql`
    select coalesce(sum(amount_cents), 0)::bigint as total
    from payments
    where organization_id = ${organizationId}
      and status = 'CONFIRMED'
      and paid_at >= ${janela.from}
      and paid_at < ${janela.to}
  `);
  return Number(rows[0]?.total ?? 0);
}

/** Situação do pátio AGORA: independe do período escolhido na tela. */
export async function patio(tx: Tx, organizationId: string) {
  const { rows } = await tx.execute<{ status: string; count: number }>(sql`
    select work_orders.status, count(*)::int as count
    from work_orders
    where work_orders.organization_id = ${organizationId} and ${NO_PATIO}
    group by work_orders.status
  `);
  const { rows: veiculos } = await tx.execute<{ total: number }>(sql`
    select count(distinct work_orders.vehicle_id)::int as total
    from work_orders
    where work_orders.organization_id = ${organizationId} and ${NO_PATIO}
  `);
  return { porStatus: rows, veiculos: veiculos[0]?.total ?? 0 };
}

/** Compromissos de hoje que ainda valem (cancelado e falta não contam). */
export async function agendamentosDoDia(tx: Tx, organizationId: string, janela: Janela) {
  const { rows } = await tx.execute<{ total: number; unconfirmed: number }>(sql`
    select count(*)::int as total,
           (count(*) filter (where status = 'SCHEDULED'))::int as unconfirmed
    from appointments
    where organization_id = ${organizationId}
      and status not in ('CANCELED', 'NO_SHOW')
      and starts_at >= ${janela.from}
      and starts_at < ${janela.to}
  `);
  return rows[0] ?? { total: 0, unconfirmed: 0 };
}

export async function clientesNovos(tx: Tx, organizationId: string, janela: Janela): Promise<number> {
  const { rows } = await tx.execute<{ total: number }>(sql`
    select count(*)::int as total
    from customers
    where organization_id = ${organizationId}
      and deleted_at is null
      and created_at >= ${janela.from}
      and created_at < ${janela.to}
  `);
  return rows[0]?.total ?? 0;
}

/**
 * Taxa de aprovação: sai das PROVAS (`quote_approvals`), não do status do
 * orçamento. É a resposta do cliente, com data, que a oficina quer medir —
 * "aprovou em parte" conta como aprovado na quantidade e pelo valor real.
 */
export async function aprovacoesNoPeriodo(tx: Tx, organizationId: string, janela: Janela) {
  const { rows } = await tx.execute<{
    answered: number;
    approved: number;
    offered: string;
    approved_value: string;
  }>(sql`
    select count(*)::int as answered,
           (count(*) filter (where a.decision <> 'REJECTED'))::int as approved,
           coalesce(sum(q.total_cents), 0)::bigint as offered,
           coalesce(sum(a.approved_total_cents), 0)::bigint as approved_value
    from quote_approvals a
    join quotes q on q.organization_id = a.organization_id and q.id = a.quote_id
    where a.organization_id = ${organizationId}
      and a.created_at >= ${janela.from}
      and a.created_at < ${janela.to}
  `);
  return rows[0] ?? { answered: 0, approved: 0, offered: '0', approved_value: '0' };
}

/** Orçamentos ainda sem resposta, agora. */
export async function orcamentosPendentes(tx: Tx, organizationId: string): Promise<number> {
  const { rows } = await tx.execute<{ total: number }>(sql`
    select count(*)::int as total from quotes
    where organization_id = ${organizationId} and status = 'SENT'
  `);
  return rows[0]?.total ?? 0;
}

/** O que mais saiu no período, pelo que ficou gravado no item da OS. */
export async function maisUsados(tx: Tx, organizationId: string, janela: Janela) {
  const { rows } = await tx.execute<{ type: string; name: string; count: number; quantity: string }>(sql`
    select i.type,
           i.description as name,
           count(*)::int as count,
           coalesce(sum(i.quantity), 0)::text as quantity
    from work_order_items i
    join work_orders on work_orders.organization_id = i.organization_id and work_orders.id = i.work_order_id
    where i.organization_id = ${organizationId}
      and i.approval_status <> 'REJECTED'
      and work_orders.status <> 'CANCELED'
      and work_orders.completed_at >= ${janela.from}
      and work_orders.completed_at < ${janela.to}
    group by i.type, i.description
    order by count(*) desc, i.description
    limit 20
  `);
  return rows;
}

// --------------------------- atenção necessária ---------------------------

export interface LinhaDeAtencao extends Record<string, unknown> {
  total: number;
  id: string;
  number: number | null;
  label: string;
  /** o driver devolve a data crua do Postgres: texto, não `Date` */
  since: string | null;
  amount: string | null;
}

/** O total vem junto na mesma consulta: `count(*) over ()` evita uma ida a mais. */
const TOTAL = sql`count(*) over ()::int as total`;

/** "OS 182 · Gol ABC1D34" — o que a pessoa reconhece na lista. */
const ETIQUETA_OS = sql`concat_ws(' · ',
  'OS ' || work_orders.number,
  nullif(trim(concat_ws(' ', vehicles.make, vehicles.model)), ''),
  vehicles.plate
)`;

const DA_OS = sql`
  from work_orders
  join vehicles on vehicles.organization_id = work_orders.organization_id and vehicles.id = work_orders.vehicle_id
`;

export async function orcamentosParados(tx: Tx, organizationId: string, semVerDesde: Date) {
  const { rows } = await tx.execute<LinhaDeAtencao>(sql`
    select ${TOTAL}, quotes.id, work_orders.number, ${ETIQUETA_OS} as label,
           quotes.sent_at as since, quotes.total_cents::text as amount
    from quotes
    join work_orders on work_orders.organization_id = quotes.organization_id and work_orders.id = quotes.work_order_id
    join vehicles on vehicles.organization_id = work_orders.organization_id and vehicles.id = work_orders.vehicle_id
    where quotes.organization_id = ${organizationId}
      and quotes.status = 'SENT'
      -- quem nem abriu tem grupo próprio, mais urgente: não repete aqui
      and (quotes.first_viewed_at is not null or quotes.sent_at >= ${semVerDesde})
    order by quotes.sent_at
    limit 5
  `);
  const naoVistos = await tx.execute<LinhaDeAtencao>(sql`
    select ${TOTAL}, quotes.id, work_orders.number, ${ETIQUETA_OS} as label,
           quotes.sent_at as since, quotes.total_cents::text as amount
    from quotes
    join work_orders on work_orders.organization_id = quotes.organization_id and work_orders.id = quotes.work_order_id
    join vehicles on vehicles.organization_id = work_orders.organization_id and vehicles.id = work_orders.vehicle_id
    where quotes.organization_id = ${organizationId}
      and quotes.status = 'SENT'
      and quotes.first_viewed_at is null
      and quotes.sent_at < ${semVerDesde}
    order by quotes.sent_at
    limit 5
  `);
  return { esperando: rows, naoVistos: naoVistos.rows };
}

/** Previsão de entrega vencida, com o carro ainda na oficina. */
export async function previsaoVencida(tx: Tx, organizationId: string, agora: Date) {
  const { rows } = await tx.execute<LinhaDeAtencao>(sql`
    select ${TOTAL}, work_orders.id, work_orders.number, ${ETIQUETA_OS} as label,
           work_orders.promised_at as since, null::text as amount
    ${DA_OS}
    where work_orders.organization_id = ${organizationId}
      and ${NO_PATIO}
      and work_orders.promised_at is not null
      and work_orders.promised_at < ${agora}
    order by work_orders.promised_at
    limit 5
  `);
  return rows;
}

/** Pronto e parado: o carro ocupa vaga e o cliente não sabe. */
export async function prontoSemEntregar(tx: Tx, organizationId: string, limite: Date) {
  const { rows } = await tx.execute<LinhaDeAtencao>(sql`
    select ${TOTAL}, work_orders.id, work_orders.number, ${ETIQUETA_OS} as label,
           work_orders.completed_at as since, null::text as amount
    ${DA_OS}
    where work_orders.organization_id = ${organizationId}
      and work_orders.status = 'COMPLETED'
      and work_orders.completed_at < ${limite}
    order by work_orders.completed_at
    limit 5
  `);
  return rows;
}

/** Entregue devendo: o fiado é permitido, mas não pode ser esquecido. */
export async function entregueEmAberto(tx: Tx, organizationId: string) {
  const { rows } = await tx.execute<LinhaDeAtencao>(sql`
    select ${TOTAL}, work_orders.id, work_orders.number, ${ETIQUETA_OS} as label,
           work_orders.delivered_at as since,
           (${DEVIDO} - work_orders.paid_cents)::text as amount
    ${DA_OS}
    where work_orders.organization_id = ${organizationId}
      and work_orders.status = 'DELIVERED'
      and ${DEVIDO} > work_orders.paid_cents
    order by work_orders.delivered_at desc
    limit 5
  `);
  return rows;
}

/** Peça no vermelho ou abaixo do mínimo: o mesmo critério da tela de estoque. */
export async function estoqueEmFalta(tx: Tx, organizationId: string) {
  const { rows } = await tx.execute<LinhaDeAtencao>(sql`
    select ${TOTAL}, parts.id, null::int as number,
           concat_ws(' · ', parts.name, parts.sku) as label,
           null::timestamptz as since,
           (parts.quantity_on_hand - parts.quantity_reserved)::text as amount
    from parts
    where parts.organization_id = ${organizationId}
      and parts.deleted_at is null
      and parts.is_active
      and parts.track_stock
      and parts.quantity_on_hand - parts.quantity_reserved < parts.min_quantity
    order by parts.quantity_on_hand - parts.quantity_reserved
    limit 5
  `);
  return rows;
}

/** Compromisso de hoje que ninguém confirmou: é a ligação que evita o furo. */
export async function naoConfirmadosHoje(tx: Tx, organizationId: string, janela: Janela) {
  const { rows } = await tx.execute<LinhaDeAtencao>(sql`
    select ${TOTAL}, appointments.id, null::int as number,
           concat_ws(' · ', appointments.title, customers.name) as label,
           appointments.starts_at as since, null::text as amount
    from appointments
    join customers on customers.organization_id = appointments.organization_id
                  and customers.id = appointments.customer_id
    where appointments.organization_id = ${organizationId}
      and appointments.status = 'SCHEDULED'
      and appointments.starts_at >= ${janela.from}
      and appointments.starts_at < ${janela.to}
    order by appointments.starts_at
    limit 5
  `);
  return rows;
}

// -------------------------------- gráficos --------------------------------

export interface PontoDoGrafico extends Record<string, unknown> {
  day: string;
  value: string;
}

/**
 * A série por dia. O `at time zone` agrupa pelo calendário da OFICINA: sem ele,
 * uma OS finalizada às 22h de São Paulo cairia no dia seguinte (UTC).
 */
export async function serieDeOS(
  tx: Tx,
  organizationId: string,
  janela: Janela,
  timeZone: string,
  metric: 'revenue' | 'count' | 'avg',
) {
  const valor =
    metric === 'revenue'
      ? sql`coalesce(sum(${DEVIDO}), 0)::text`
      : metric === 'count'
        ? sql`count(*)::text`
        : sql`coalesce(round(sum(${DEVIDO}) / nullif(count(*), 0)), 0)::text`;
  const { rows } = await tx.execute<PontoDoGrafico>(sql`
    select to_char((work_orders.completed_at at time zone ${timeZone})::date, 'YYYY-MM-DD') as day,
           ${valor} as value
    from work_orders
    where work_orders.organization_id = ${organizationId}
      and work_orders.status <> 'CANCELED'
      and work_orders.completed_at >= ${janela.from}
      and work_orders.completed_at < ${janela.to}
    group by 1
    order by 1
  `);
  return rows;
}

export async function serieDeAprovacao(tx: Tx, organizationId: string, janela: Janela, timeZone: string) {
  const { rows } = await tx.execute<PontoDoGrafico>(sql`
    select to_char((a.created_at at time zone ${timeZone})::date, 'YYYY-MM-DD') as day,
           round(100.0 * count(*) filter (where a.decision <> 'REJECTED') / count(*))::text as value
    from quote_approvals a
    where a.organization_id = ${organizationId}
      and a.created_at >= ${janela.from}
      and a.created_at < ${janela.to}
    group by 1
    order by 1
  `);
  return rows;
}

export async function serieDeClientes(tx: Tx, organizationId: string, janela: Janela, timeZone: string) {
  const { rows } = await tx.execute<PontoDoGrafico>(sql`
    select to_char((created_at at time zone ${timeZone})::date, 'YYYY-MM-DD') as day,
           count(*)::text as value
    from customers
    where organization_id = ${organizationId}
      and deleted_at is null
      and created_at >= ${janela.from}
      and created_at < ${janela.to}
    group by 1
    order by 1
  `);
  return rows;
}
