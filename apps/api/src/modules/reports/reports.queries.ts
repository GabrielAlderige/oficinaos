import { sql } from 'drizzle-orm';
import type { ReportColumn, ReportKey, ReportRow } from '@oficinaos/shared';
import type { Tx } from '../../db/tenant';

/**
 * As consultas dos relatórios (E15). SQL cru, como no dashboard: são
 * agregações com muitos `filter`, e o construtor deixaria isto ilegível.
 *
 * Cada relatório declara as colunas junto com as linhas — a tela desenha
 * qualquer um com o mesmo componente, e relatório novo não precisa de tela
 * nova nem de mexer no CSV.
 */

export interface Janela {
  from: Date;
  to: Date;
  fromDay: string;
  toDay: string;
}

export interface ReportResult {
  columns: ReportColumn[];
  rows: ReportRow[];
  totals: ReportRow | null;
  summary: string | null;
}

/** O que a OS vale: o aprovado, ou o total quando não houve orçamento (mesma regra do dashboard). */
const DEVIDO = sql`case when work_orders.approved_total_cents > 0 then work_orders.approved_total_cents else work_orders.total_cents end`;

const num = (valor: unknown): number => Number(valor ?? 0);

type Consulta = (tx: Tx, organizationId: string, janela: Janela, limit: number) => Promise<ReportResult>;

// ------------------------------- faturamento -------------------------------

const faturamento: Consulta = async (tx, organizationId, janela) => {
  const { rows } = await tx.execute<Record<string, unknown>>(sql`
    select to_char((completed_at at time zone (select timezone from organizations where id = ${organizationId}))::date, 'YYYY-MM-DD') as dia,
           count(*)::int as ordens,
           coalesce(sum(${DEVIDO}), 0)::bigint as faturado,
           coalesce(sum(work_orders.paid_cents), 0)::bigint as recebido
    from work_orders
    where work_orders.organization_id = ${organizationId}
      and work_orders.status <> 'CANCELED'
      and work_orders.completed_at >= ${janela.from} and work_orders.completed_at < ${janela.to}
    group by 1
    order by 1
  `);
  const linhas = rows.map((linha) => ({
    dia: String(linha.dia),
    ordens: num(linha.ordens),
    faturado: num(linha.faturado),
    recebido: num(linha.recebido),
    ticket: num(linha.ordens) ? Math.round(num(linha.faturado) / num(linha.ordens)) : 0,
  }));
  const ordens = linhas.reduce((soma, linha) => soma + linha.ordens, 0);
  const faturado = linhas.reduce((soma, linha) => soma + linha.faturado, 0);
  const recebido = linhas.reduce((soma, linha) => soma + linha.recebido, 0);
  return {
    columns: [
      { key: 'dia', label: 'Dia', format: 'date' },
      { key: 'ordens', label: 'OS finalizadas', format: 'number' },
      { key: 'faturado', label: 'Faturado', format: 'money' },
      { key: 'recebido', label: 'Recebido', format: 'money' },
      { key: 'ticket', label: 'Ticket médio', format: 'money' },
    ],
    rows: linhas,
    totals: {
      dia: 'Total',
      ordens,
      faturado,
      recebido,
      ticket: ordens ? Math.round(faturado / ordens) : 0,
    },
    summary: ordens
      ? `${ordens} ${ordens === 1 ? 'OS finalizada' : 'OS finalizadas'} no período. Faturado e recebido são contas diferentes: o fiado aparece na diferença.`
      : 'Nenhuma OS finalizada no período.',
  };
};

// --------------------------------- serviços ---------------------------------

const servicos: Consulta = async (tx, organizationId, janela, limit) => {
  const { rows } = await tx.execute<Record<string, unknown>>(sql`
    select coalesce(s.name, i.description) as servico,
           count(*)::int as vezes,
           coalesce(sum(i.total_cents), 0)::bigint as faturado,
           coalesce(sum(i.estimated_minutes), 0)::int as estimado
    from work_order_items i
    join work_orders on work_orders.organization_id = i.organization_id and work_orders.id = i.work_order_id
    left join services s on s.organization_id = i.organization_id and s.id = i.service_id
    where i.organization_id = ${organizationId}
      and i.type = 'SERVICE'
      and i.approval_status <> 'REJECTED'
      and work_orders.status <> 'CANCELED'
      and work_orders.completed_at >= ${janela.from} and work_orders.completed_at < ${janela.to}
    group by 1
    order by 3 desc
    limit ${limit}
  `);
  const linhas = rows.map((linha) => ({
    servico: String(linha.servico),
    vezes: num(linha.vezes),
    faturado: num(linha.faturado),
    medio: num(linha.vezes) ? Math.round(num(linha.faturado) / num(linha.vezes)) : 0,
  }));
  return {
    columns: [
      { key: 'servico', label: 'Serviço', format: 'text' },
      { key: 'vezes', label: 'Vezes', format: 'number' },
      { key: 'faturado', label: 'Faturado', format: 'money' },
      { key: 'medio', label: 'Média por vez', format: 'money' },
    ],
    rows: linhas,
    totals: {
      servico: 'Total',
      vezes: linhas.reduce((soma, linha) => soma + linha.vezes, 0),
      faturado: linhas.reduce((soma, linha) => soma + linha.faturado, 0),
      medio: null,
    },
    summary: linhas.length ? `O serviço que mais rendeu foi "${linhas[0]!.servico}".` : 'Nenhum serviço no período.',
  };
};

// ---------------------------------- peças ----------------------------------

const pecas: Consulta = async (tx, organizationId, janela, limit) => {
  const { rows } = await tx.execute<Record<string, unknown>>(sql`
    select coalesce(p.name, i.description) as peca,
           coalesce(sum(i.quantity), 0)::numeric as quantidade,
           coalesce(sum(i.total_cents), 0)::bigint as faturado,
           coalesce(sum(round(i.quantity * coalesce(i.unit_cost_cents, 0))), 0)::bigint as custo
    from work_order_items i
    join work_orders on work_orders.organization_id = i.organization_id and work_orders.id = i.work_order_id
    left join parts p on p.organization_id = i.organization_id and p.id = i.part_id
    where i.organization_id = ${organizationId}
      and i.type = 'PART'
      and i.approval_status <> 'REJECTED'
      and work_orders.status <> 'CANCELED'
      and work_orders.completed_at >= ${janela.from} and work_orders.completed_at < ${janela.to}
    group by 1
    order by 3 desc
    limit ${limit}
  `);
  const linhas = rows.map((linha) => ({
    peca: String(linha.peca),
    quantidade: Number(linha.quantidade),
    faturado: num(linha.faturado),
    custo: num(linha.custo),
    margem: num(linha.faturado) - num(linha.custo),
  }));
  const faturado = linhas.reduce((soma, linha) => soma + linha.faturado, 0);
  const custo = linhas.reduce((soma, linha) => soma + linha.custo, 0);
  return {
    columns: [
      { key: 'peca', label: 'Peça', format: 'text' },
      { key: 'quantidade', label: 'Quantidade', format: 'quantity' },
      { key: 'custo', label: 'Custo', format: 'money' },
      { key: 'faturado', label: 'Faturado', format: 'money' },
      { key: 'margem', label: 'Margem', format: 'money' },
    ],
    rows: linhas,
    totals: { peca: 'Total', quantidade: null, custo, faturado, margem: faturado - custo },
    summary: linhas.length
      ? 'Custo é o custo médio da peça na hora da venda; a margem é o que sobrou dela.'
      : 'Nenhuma peça vendida no período.',
  };
};

// -------------------------------- clientes ---------------------------------

const clientes: Consulta = async (tx, organizationId, janela, limit) => {
  const { rows } = await tx.execute<Record<string, unknown>>(sql`
    select c.name as cliente,
           count(*)::int as ordens,
           coalesce(sum(${DEVIDO}), 0)::bigint as faturado,
           to_char(max(work_orders.completed_at) at time zone (select timezone from organizations where id = ${organizationId}), 'YYYY-MM-DD') as ultima
    from work_orders
    join customers c on c.organization_id = work_orders.organization_id and c.id = work_orders.customer_id
    where work_orders.organization_id = ${organizationId}
      and work_orders.status <> 'CANCELED'
      and work_orders.completed_at >= ${janela.from} and work_orders.completed_at < ${janela.to}
    group by 1
    order by 3 desc
    limit ${limit}
  `);
  const linhas = rows.map((linha) => ({
    cliente: String(linha.cliente),
    ordens: num(linha.ordens),
    faturado: num(linha.faturado),
    ticket: num(linha.ordens) ? Math.round(num(linha.faturado) / num(linha.ordens)) : 0,
    ultima: linha.ultima ? String(linha.ultima) : null,
  }));
  return {
    columns: [
      { key: 'cliente', label: 'Cliente', format: 'text' },
      { key: 'ordens', label: 'OS', format: 'number' },
      { key: 'faturado', label: 'Faturado', format: 'money' },
      { key: 'ticket', label: 'Ticket médio', format: 'money' },
      { key: 'ultima', label: 'Última visita', format: 'date' },
    ],
    rows: linhas,
    totals: {
      cliente: 'Total',
      ordens: linhas.reduce((soma, linha) => soma + linha.ordens, 0),
      faturado: linhas.reduce((soma, linha) => soma + linha.faturado, 0),
      ticket: null,
      ultima: null,
    },
    summary: linhas.length ? `${linhas.length} ${linhas.length === 1 ? 'cliente atendido' : 'clientes atendidos'} no período.` : 'Nenhum cliente atendido no período.',
  };
};

// -------------------------------- veículos ---------------------------------

const veiculos: Consulta = async (tx, organizationId, janela, limit) => {
  const { rows } = await tx.execute<Record<string, unknown>>(sql`
    select concat_ws(' ', v.make, v.model) as veiculo,
           coalesce(v.plate, '–') as placa,
           count(*)::int as ordens,
           coalesce(sum(${DEVIDO}), 0)::bigint as faturado,
           max(v.odometer_km)::int as km
    from work_orders
    join vehicles v on v.organization_id = work_orders.organization_id and v.id = work_orders.vehicle_id
    where work_orders.organization_id = ${organizationId}
      and work_orders.status <> 'CANCELED'
      and work_orders.completed_at >= ${janela.from} and work_orders.completed_at < ${janela.to}
    group by 1, 2
    order by 4 desc
    limit ${limit}
  `);
  const linhas = rows.map((linha) => ({
    veiculo: String(linha.veiculo),
    placa: String(linha.placa),
    ordens: num(linha.ordens),
    faturado: num(linha.faturado),
    km: linha.km === null ? null : num(linha.km),
  }));
  return {
    columns: [
      { key: 'veiculo', label: 'Veículo', format: 'text' },
      { key: 'placa', label: 'Placa', format: 'text' },
      { key: 'ordens', label: 'OS', format: 'number' },
      { key: 'faturado', label: 'Faturado', format: 'money' },
      { key: 'km', label: 'Km', format: 'number' },
    ],
    rows: linhas,
    totals: {
      veiculo: 'Total',
      placa: null,
      ordens: linhas.reduce((soma, linha) => soma + linha.ordens, 0),
      faturado: linhas.reduce((soma, linha) => soma + linha.faturado, 0),
      km: null,
    },
    summary: linhas.length ? `${linhas.length} ${linhas.length === 1 ? 'veículo atendido' : 'veículos atendidos'} no período.` : 'Nenhum veículo atendido no período.',
  };
};

// -------------------------------- mecânicos ---------------------------------

const mecanicos: Consulta = async (tx, organizationId, janela) => {
  const { rows } = await tx.execute<Record<string, unknown>>(sql`
    with tempos as (
      select t.work_order_item_id, sum(t.minutes)::int as minutos
      from work_order_item_timers t
      where t.organization_id = ${organizationId} and t.minutes is not null
      group by 1
    )
    select u.name as mecanico,
           count(distinct work_orders.id)::int as ordens,
           count(*)::int as servicos,
           coalesce(sum(i.total_cents), 0)::bigint as faturado,
           coalesce(sum(i.estimated_minutes), 0)::int as estimado,
           coalesce(sum(tempos.minutos), 0)::int as real
    from work_order_items i
    join work_orders on work_orders.organization_id = i.organization_id and work_orders.id = i.work_order_id
    -- o mecânico do item, ou o da OS: a oficina costuma atribuir a OS inteira
    join users u on u.id = coalesce(i.mechanic_user_id, work_orders.mechanic_user_id)
    left join tempos on tempos.work_order_item_id = i.id
    where i.organization_id = ${organizationId}
      and i.type = 'SERVICE'
      and i.approval_status <> 'REJECTED'
      and work_orders.status <> 'CANCELED'
      and work_orders.completed_at >= ${janela.from} and work_orders.completed_at < ${janela.to}
    group by u.id, u.name
    order by 4 desc
  `);
  const linhas = rows.map((linha) => {
    const estimado = num(linha.estimado);
    const real = num(linha.real);
    return {
      mecanico: String(linha.mecanico),
      ordens: num(linha.ordens),
      servicos: num(linha.servicos),
      faturado: num(linha.faturado),
      estimado,
      real,
      // quanto o real passou do estimado, em basis points (positivo = demorou mais)
      desvio: estimado > 0 && real > 0 ? Math.round(((real - estimado) / estimado) * 10_000) : null,
    };
  });
  return {
    columns: [
      { key: 'mecanico', label: 'Mecânico', format: 'text' },
      { key: 'ordens', label: 'OS', format: 'number' },
      { key: 'servicos', label: 'Serviços', format: 'number' },
      { key: 'faturado', label: 'Faturado', format: 'money' },
      { key: 'estimado', label: 'Tempo estimado', format: 'minutes' },
      { key: 'real', label: 'Tempo real', format: 'minutes' },
      { key: 'desvio', label: 'Desvio', format: 'percent' },
    ],
    rows: linhas,
    totals: {
      mecanico: 'Total',
      ordens: null,
      servicos: linhas.reduce((soma, linha) => soma + linha.servicos, 0),
      faturado: linhas.reduce((soma, linha) => soma + linha.faturado, 0),
      estimado: linhas.reduce((soma, linha) => soma + linha.estimado, 0),
      real: linhas.reduce((soma, linha) => soma + linha.real, 0),
      desvio: null,
    },
    summary: !linhas.length
      ? 'Nenhum serviço com mecânico responsável no período. O mecânico vem do item ou, na falta dele, da OS.'
      : linhas.some((linha) => linha.real > 0)
        ? 'Tempo real vem do cronômetro do item de serviço; o estimado, do catálogo. Sem cronômetro, o real fica zero.'
        : 'Ninguém usou o cronômetro no período: o tempo real só aparece quando o mecânico inicia e para o serviço na OS.',
  };
};

// -------------------------------- aprovação ---------------------------------

const aprovacao: Consulta = async (tx, organizationId, janela) => {
  const { rows } = await tx.execute<Record<string, unknown>>(sql`
    select q.status,
           count(*)::int as quantidade,
           coalesce(sum(q.total_cents), 0)::bigint as valor
    from quotes q
    where q.organization_id = ${organizationId}
      and q.sent_at >= ${janela.from} and q.sent_at < ${janela.to}
    group by 1
  `);
  const porStatus = new Map(rows.map((linha) => [String(linha.status), linha]));
  const ROTULOS: Record<string, string> = {
    SENT: 'Aguardando resposta',
    VIEWED: 'Visto, sem resposta',
    APPROVED: 'Aprovado',
    PARTIALLY_APPROVED: 'Aprovado em parte',
    REJECTED: 'Recusado',
    EXPIRED: 'Vencido',
    SUPERSEDED: 'Substituído',
    CANCELED: 'Cancelado',
  };
  const linhas = [...porStatus.entries()].map(([status, linha]) => ({
    situacao: ROTULOS[status] ?? status,
    quantidade: num(linha.quantidade),
    valor: num(linha.valor),
  }));
  const total = linhas.reduce((soma, linha) => soma + linha.quantidade, 0);
  const valorTotal = linhas.reduce((soma, linha) => soma + linha.valor, 0);
  const aprovados = ['APPROVED', 'PARTIALLY_APPROVED']
    .map((status) => porStatus.get(status))
    .filter(Boolean)
    .reduce((soma, linha) => soma + num(linha!.quantidade), 0);
  const valorAprovado = ['APPROVED', 'PARTIALLY_APPROVED']
    .map((status) => porStatus.get(status))
    .filter(Boolean)
    .reduce((soma, linha) => soma + num(linha!.valor), 0);

  return {
    columns: [
      { key: 'situacao', label: 'Situação', format: 'text' },
      { key: 'quantidade', label: 'Orçamentos', format: 'number' },
      { key: 'valor', label: 'Valor', format: 'money' },
    ],
    rows: linhas,
    totals: { situacao: 'Total', quantidade: total, valor: valorTotal },
    summary: total
      ? `Taxa de aprovação: ${Math.round((aprovados / total) * 100)}% em quantidade e ${
          valorTotal ? Math.round((valorAprovado / valorTotal) * 100) : 0
        }% em valor. As duas quase nunca batem — e é a de VALOR que paga as contas.`
      : 'Nenhum orçamento enviado no período.',
  };
};

// --------------------------------- estoque ----------------------------------

const estoque: Consulta = async (tx, organizationId, _janela, limit) => {
  const { rows } = await tx.execute<Record<string, unknown>>(sql`
    select p.name as peca,
           coalesce(p.sku, '') as sku,
           p.quantity_on_hand::numeric as saldo,
           p.quantity_reserved::numeric as reservado,
           p.min_quantity::numeric as minimo,
           coalesce(p.average_cost_cents, 0)::bigint as custo,
           round(p.quantity_on_hand * coalesce(p.average_cost_cents, 0))::bigint as parado
    from parts p
    where p.organization_id = ${organizationId} and p.deleted_at is null and p.track_stock
    order by 7 desc
    limit ${limit}
  `);
  const linhas = rows.map((linha) => ({
    peca: String(linha.peca),
    sku: String(linha.sku),
    saldo: Number(linha.saldo),
    reservado: Number(linha.reservado),
    disponivel: Number(linha.saldo) - Number(linha.reservado),
    minimo: Number(linha.minimo),
    custo: num(linha.custo),
    parado: num(linha.parado),
  }));
  const abaixo = linhas.filter((linha) => linha.disponivel < Math.max(linha.minimo, 0.001)).length;
  return {
    columns: [
      { key: 'peca', label: 'Peça', format: 'text' },
      { key: 'sku', label: 'Código', format: 'text' },
      { key: 'saldo', label: 'Em estoque', format: 'quantity' },
      { key: 'reservado', label: 'Reservado', format: 'quantity' },
      { key: 'disponivel', label: 'Disponível', format: 'quantity' },
      { key: 'minimo', label: 'Mínimo', format: 'quantity' },
      { key: 'custo', label: 'Custo médio', format: 'money' },
      { key: 'parado', label: 'Dinheiro parado', format: 'money' },
    ],
    rows: linhas,
    totals: {
      peca: 'Total',
      sku: null,
      saldo: null,
      reservado: null,
      disponivel: null,
      minimo: null,
      custo: null,
      parado: linhas.reduce((soma, linha) => soma + linha.parado, 0),
    },
    summary: `Posição de AGORA, não do período. ${abaixo} ${abaixo === 1 ? 'peça está' : 'peças estão'} abaixo do mínimo.`,
  };
};

// ------------------------------- fornecedores -------------------------------

const fornecedores: Consulta = async (tx, organizationId, janela, limit) => {
  const { rows } = await tx.execute<Record<string, unknown>>(sql`
    select s.name as fornecedor,
           count(distinct po.id)::int as pedidos,
           coalesce(sum(r.valor), 0)::bigint as comprado,
           avg(extract(epoch from (po.received_at - po.ordered_at)) / 86400)::numeric(6,1) as dias,
           s.lead_time_days::int as prometido
    from purchase_orders po
    join suppliers s on s.organization_id = po.organization_id and s.id = po.supplier_id
    left join lateral (
      select sum(ri.quantity * ri.landed_unit_cost_cents) as valor
      from purchase_receipt_items ri
      join purchase_receipts rc on rc.organization_id = ri.organization_id and rc.id = ri.receipt_id
      where rc.organization_id = po.organization_id and rc.purchase_order_id = po.id
    ) r on true
    where po.organization_id = ${organizationId}
      and po.status <> 'CANCELED'
      and po.ordered_at >= ${janela.from} and po.ordered_at < ${janela.to}
    group by s.id, s.name, s.lead_time_days
    order by 3 desc
    limit ${limit}
  `);
  const linhas = rows.map((linha) => ({
    fornecedor: String(linha.fornecedor),
    pedidos: num(linha.pedidos),
    comprado: Math.round(num(linha.comprado)),
    dias: linha.dias === null ? null : Number(linha.dias),
    prometido: linha.prometido === null ? null : num(linha.prometido),
  }));
  return {
    columns: [
      { key: 'fornecedor', label: 'Fornecedor', format: 'text' },
      { key: 'pedidos', label: 'Pedidos', format: 'number' },
      { key: 'comprado', label: 'Comprado', format: 'money' },
      { key: 'prometido', label: 'Prazo prometido (dias)', format: 'number' },
      { key: 'dias', label: 'Prazo real (dias)', format: 'quantity' },
    ],
    rows: linhas,
    totals: {
      fornecedor: 'Total',
      pedidos: linhas.reduce((soma, linha) => soma + linha.pedidos, 0),
      comprado: linhas.reduce((soma, linha) => soma + linha.comprado, 0),
      prometido: null,
      dias: null,
    },
    summary: linhas.length
      ? 'O prazo real é do pedido ao recebimento completo; pedido ainda em aberto não entra na média.'
      : 'Nenhum pedido de compra no período.',
  };
};

export const REPORT_QUERIES: Record<Exclude<ReportKey, 'profit'>, Consulta> = {
  revenue: faturamento,
  services: servicos,
  parts: pecas,
  customers: clientes,
  vehicles: veiculos,
  mechanics: mecanicos,
  approval: aprovacao,
  inventory: estoque,
  suppliers: fornecedores,
};
