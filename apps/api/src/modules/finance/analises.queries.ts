import { sql } from 'drizzle-orm';
import { ANALISES_TOP } from '@oficinaos/shared';
import type { Tx } from '../../db/tenant';
import type { Janela } from './finance.repository';

/**
 * As consultas das análises (E51, fase 3). SQL cru como nos relatórios, e com
 * as MESMAS regras deles e da DRE: OS cancelada não conta, item recusado não
 * conta, a OS vale o aprovado (ou o total, sem orçamento), a peça sai pelo
 * custo médio da hora em que saiu.
 */

const num = (valor: unknown): number => Number(valor ?? 0);

/** O que a OS vale (mesma regra do dashboard e dos relatórios). */
const DEVIDO = sql`case when o.approved_total_cents > 0 then o.approved_total_cents else o.total_cents end`;

/** Saídas de peça que viram custo: as mesmas da DRE (OS e balcão, menos a devolução do balcão). */
const SAIDAS = sql`('WORK_ORDER_OUT', 'COUNTER_SALE_OUT', 'COUNTER_SALE_RETURN')`;

/** Nº de OS finalizadas e o que elas valem. */
export async function ordensFinalizadas(tx: Tx, organizationId: string, janela: Janela) {
  const { rows } = await tx.execute<Record<string, unknown>>(sql`
    select count(*)::int as ordens, coalesce(sum(${DEVIDO}), 0)::bigint as devido
    from work_orders o
    where o.organization_id = ${organizationId}
      and o.status <> 'CANCELED'
      and o.completed_at >= ${janela.from} and o.completed_at < ${janela.to}
  `);
  return { ordens: num(rows[0]?.ordens), devidoCents: num(rows[0]?.devido) };
}

/**
 * Clientes com OS finalizada no período, e quantos deles já tinham OS
 * finalizada antes do período começar.
 */
export async function clientesQueVoltaram(tx: Tx, organizationId: string, janela: Janela) {
  const { rows } = await tx.execute<Record<string, unknown>>(sql`
    with atendidos as (
      select distinct o.customer_id
      from work_orders o
      where o.organization_id = ${organizationId}
        and o.status <> 'CANCELED'
        and o.completed_at >= ${janela.from} and o.completed_at < ${janela.to}
    )
    select count(*)::int as atendidos,
           count(*) filter (where exists (
             select 1 from work_orders antes
             where antes.organization_id = ${organizationId}
               and antes.customer_id = atendidos.customer_id
               and antes.status <> 'CANCELED'
               and antes.completed_at < ${janela.from}
           ))::int as voltaram
    from atendidos
  `);
  return { atendidos: num(rows[0]?.atendidos), voltaram: num(rows[0]?.voltaram) };
}

/**
 * O estoque a custo num instante: de cada peça, o saldo e o custo médio do
 * último movimento ANTES dele (o livro-razão é imutável, então o passado não muda).
 */
export async function valorDoEstoqueEm(tx: Tx, organizationId: string, instante: Date): Promise<number> {
  const { rows } = await tx.execute<Record<string, unknown>>(sql`
    select coalesce(round(sum(greatest(ultimo.balance_after, 0) * coalesce(ultimo.average_cost_after_cents, p.average_cost_cents, 0))), 0)::bigint as valor
    from (
      select distinct on (m.part_id) m.part_id, m.balance_after, m.average_cost_after_cents
      from inventory_movements m
      where m.organization_id = ${organizationId} and m.created_at < ${instante}
      order by m.part_id, m.created_at desc, m.id desc
    ) ultimo
    join parts p on p.organization_id = ${organizationId} and p.id = ultimo.part_id
  `);
  return num(rows[0]?.valor);
}

/** O primeiro movimento de estoque da oficina: antes dele não havia ritmo de saída a medir. */
export async function primeiroMovimento(tx: Tx, organizationId: string): Promise<Date | null> {
  const { rows } = await tx.execute<{ primeiro: Date | string | null }>(sql`
    select min(created_at) as primeiro from inventory_movements where organization_id = ${organizationId}
  `);
  const primeiro = rows[0]?.primeiro;
  return primeiro ? new Date(primeiro) : null;
}

/** As peças que mais saíram (OS + balcão), com o custo e o saldo de agora. */
export async function pecasQueMaisSaem(tx: Tx, organizationId: string, janela: Janela) {
  const { rows } = await tx.execute<Record<string, unknown>>(sql`
    select p.name as peca,
           sum(-m.quantity)::numeric as quantidade,
           coalesce(round(sum((-m.quantity) * coalesce(m.unit_cost_cents, 0))), 0)::bigint as custo,
           case when p.track_stock and p.deleted_at is null then p.quantity_on_hand end::numeric as saldo
    from inventory_movements m
    join parts p on p.organization_id = m.organization_id and p.id = m.part_id
    where m.organization_id = ${organizationId}
      and m.type in ${SAIDAS}
      and m.created_at >= ${janela.from} and m.created_at < ${janela.to}
    group by p.id, p.name
    having sum(-m.quantity) > 0
    order by 2 desc, 3 desc
    limit ${ANALISES_TOP}
  `);
  return rows.map((r) => ({
    peca: String(r.peca),
    quantidade: Number(r.quantidade),
    custoCents: num(r.custo),
    saldo: r.saldo === null ? null : Number(r.saldo),
  }));
}

/**
 * Os serviços entregues: cobrado, comissão, e o tempo — o do cronômetro quando
 * o item foi cronometrado, senão o do catálogo. Ordenados pelo lucro.
 */
export async function servicosEntregues(tx: Tx, organizationId: string, janela: Janela) {
  const { rows } = await tx.execute<Record<string, unknown>>(sql`
    with tempos as (
      select t.work_order_item_id, sum(t.minutes)::int as minutos
      from work_order_item_timers t
      where t.organization_id = ${organizationId} and t.minutes is not null
      group by 1
    ),
    itens as (
      select coalesce(s.name, i.description) as servico,
             i.total_cents,
             case when i.commission_user_id is not null and coalesce(i.commission_bps, 0) > 0
                  then round(i.total_cents * i.commission_bps / 10000.0) else 0 end as comissao,
             tempos.minutos as cronometro,
             i.estimated_minutes as catalogo
      from work_order_items i
      join work_orders o on o.organization_id = i.organization_id and o.id = i.work_order_id
      left join services s on s.organization_id = i.organization_id and s.id = i.service_id
      left join tempos on tempos.work_order_item_id = i.id
      where i.organization_id = ${organizationId}
        and i.type = 'SERVICE'
        and i.approval_status <> 'REJECTED'
        and o.status <> 'CANCELED'
        and o.completed_at >= ${janela.from} and o.completed_at < ${janela.to}
    )
    select servico,
           count(*)::int as vezes,
           coalesce(sum(total_cents), 0)::bigint as faturado,
           coalesce(sum(comissao), 0)::bigint as comissao,
           coalesce(sum(coalesce(cronometro, catalogo, 0)), 0)::int as minutos,
           count(*) filter (where cronometro is not null)::int as cronometrados,
           count(*) filter (where cronometro is null and catalogo is not null)::int as pelo_catalogo
    from itens
    group by servico
    order by (coalesce(sum(total_cents), 0) - coalesce(sum(comissao), 0)) desc
    limit ${ANALISES_TOP}
  `);
  return rows.map((r) => ({
    servico: String(r.servico),
    vezes: num(r.vezes),
    faturadoCents: num(r.faturado),
    comissaoCents: num(r.comissao),
    minutos: num(r.minutos),
    cronometrados: num(r.cronometrados),
    peloCatalogo: num(r.pelo_catalogo),
  }));
}

/**
 * Por mecânico (o do item ou, na falta, o da OS — como no relatório): horas
 * vendidas (catálogo) de tudo o que entregou, horas trabalhadas (cronômetro),
 * e as vendidas SÓ dos itens cronometrados, que é a base justa da eficiência.
 */
export async function produtividade(tx: Tx, organizationId: string, janela: Janela) {
  const { rows } = await tx.execute<Record<string, unknown>>(sql`
    with tempos as (
      select t.work_order_item_id, sum(t.minutes)::int as minutos
      from work_order_item_timers t
      where t.organization_id = ${organizationId} and t.minutes is not null
      group by 1
    )
    select u.name as mecanico,
           count(*)::int as servicos,
           coalesce(sum(i.total_cents), 0)::bigint as faturado,
           coalesce(sum(i.estimated_minutes), 0)::int as vendido,
           coalesce(sum(tempos.minutos), 0)::int as trabalhado,
           coalesce(sum(i.estimated_minutes) filter (where tempos.minutos > 0), 0)::int as vendido_cronometrado,
           coalesce(sum(tempos.minutos) filter (where i.estimated_minutes > 0), 0)::int as trabalhado_com_catalogo
    from work_order_items i
    join work_orders o on o.organization_id = i.organization_id and o.id = i.work_order_id
    join users u on u.id = coalesce(i.mechanic_user_id, o.mechanic_user_id)
    left join tempos on tempos.work_order_item_id = i.id
    where i.organization_id = ${organizationId}
      and i.type = 'SERVICE'
      and i.approval_status <> 'REJECTED'
      and o.status <> 'CANCELED'
      and o.completed_at >= ${janela.from} and o.completed_at < ${janela.to}
    group by u.id, u.name
    order by 3 desc
  `);
  return rows.map((r) => ({
    mecanico: String(r.mecanico),
    servicos: num(r.servicos),
    faturadoCents: num(r.faturado),
    vendidoMin: num(r.vendido),
    trabalhadoMin: num(r.trabalhado),
    vendidoCronometradoMin: num(r.vendido_cronometrado),
    trabalhadoComCatalogoMin: num(r.trabalhado_com_catalogo),
  }));
}
