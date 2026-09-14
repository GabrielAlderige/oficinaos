import {
  can,
  dayKey,
  daysBetween,
  formatBRL,
  minutesOfDay,
  formatMinutes,
  periodRange,
  type AttentionGroup,
  type ChartQuery,
  type DashboardAttention,
  type DashboardChart,
  type DashboardQuery,
  type DashboardSummary,
  type PeriodInfo,
} from '@oficinaos/shared';
import type { AuthContext, ServiceDeps } from '../../core/auth-context';
import { readTimezone } from '../../core/org-settings';
import type { Tx } from '../../db/tenant';
import { withTenant } from '../../db/tenant';
import * as repo from './dashboard.repository';

const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

/** Quem não pode ver dinheiro recebe `null` — nunca zero, que seria mentira. */
const veDinheiro = (auth: AuthContext) => can(auth.role, 'dashboard:view_financial');

const diaEMes = (key: string) => `${key.slice(8)}/${key.slice(5, 7)}`;

/** "1 a 30 de setembro", "hoje (13/09)" — escrito como a oficina fala. */
function rotuloDoPeriodo(period: DashboardQuery['period'], fromDay: string, toDay: string): string {
  if (fromDay === toDay) return `${diaEMes(fromDay)}`;
  const mesmoMes = fromDay.slice(0, 7) === toDay.slice(0, 7);
  if (period === 'month' && mesmoMes) return `${MESES[Number(fromDay.slice(5, 7)) - 1]} de ${fromDay.slice(0, 4)}`;
  return mesmoMes
    ? `${Number(fromDay.slice(8))} a ${Number(toDay.slice(8))} de ${MESES[Number(fromDay.slice(5, 7)) - 1]}`
    : `${diaEMes(fromDay)} a ${diaEMes(toDay)}`;
}

/** "há 3 dias", "há 4 horas" — o tempo que a oficina está perdendo com aquilo. */
function tempoDesde(quando: string | null, agora: Date): string {
  if (!quando) return '';
  const minutos = Math.max(0, Math.round((agora.getTime() - Date.parse(quando)) / 60_000));
  if (minutos < 60) return 'há poucos minutos';
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `há ${horas} ${horas === 1 ? 'hora' : 'horas'}`;
  const dias = Math.round(horas / 24);
  return `há ${dias} ${dias === 1 ? 'dia' : 'dias'}`;
}

/**
 * O dashboard da oficina (docs/ROADMAP.md, E9). Duas regras mandam aqui:
 *
 * 1. **Faturado e recebido são coisas diferentes.** Faturado é o serviço
 *    entregue no período; recebido é o dinheiro que entrou. Com fiado os dois
 *    nunca batem, e somar tudo num número só esconde o problema.
 * 2. **"Hoje" é o dia da OFICINA.** O recorte sai de `periodRange` com o fuso de
 *    `organizations`, e as séries agrupam com `at time zone` — senão o
 *    faturamento do dia pega a última hora da véspera.
 *
 * A consulta é direta, sem o cache de 60 s previsto em DATABASE §7: em oficina
 * pequena o custo é baixo, e número velho logo depois de registrar um pagamento
 * parece defeito.
 */
export class DashboardService {
  constructor(private readonly deps: ServiceDeps) {}

  async summary(auth: AuthContext, query: DashboardQuery): Promise<DashboardSummary> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const agora = new Date();
      const { janela, info, timezone } = await this.periodo(tx, auth, query, agora);
      const hoje = periodRange('today', timezone, undefined, agora);

      // uma de cada vez: as consultas dividem a MESMA conexão da transação, e
      // `Promise.all` aqui só enfileira no driver (e vai quebrar no pg@9)
      const organizationId = auth.organizationId;
      const finalizadas = await repo.finalizadasNoPeriodo(tx, organizationId, janela);
      const recebido = await repo.recebidoNoPeriodo(tx, organizationId, janela);
      const servicos = await repo.servicosConcluidos(tx, organizationId, janela);
      const patio = await repo.patio(tx, organizationId);
      const agendamentos = await repo.agendamentosDoDia(tx, organizationId, hoje);
      const novos = await repo.clientesNovos(tx, organizationId, janela);
      const aprovacoes = await repo.aprovacoesNoPeriodo(tx, organizationId, janela);
      const pendentes = await repo.orcamentosPendentes(tx, organizationId);
      const usados = await repo.maisUsados(tx, organizationId, janela);

      const faturado = Number(finalizadas.billed);
      const dinheiro = veDinheiro(auth);
      const comDinheiro = (valor: number) => (dinheiro ? valor : null);

      return {
        period: info,
        billedCents: comDinheiro(faturado),
        receivedCents: comDinheiro(recebido),
        // ticket médio de zero OS é zero, não divisão por zero
        avgTicketCents: comDinheiro(finalizadas.orders ? Math.round(faturado / finalizadas.orders) : 0),
        openByStatus: patio.porStatus.map((linha) => ({
          status: linha.status as DashboardSummary['openByStatus'][number]['status'],
          count: linha.count,
        })),
        awaitingApproval: patio.porStatus.find((l) => l.status === 'AWAITING_APPROVAL')?.count ?? 0,
        vehiclesInShop: patio.veiculos,
        appointmentsToday: agendamentos.total,
        completedOrders: finalizadas.orders,
        completedServices: servicos,
        vehiclesServed: finalizadas.vehicles,
        newCustomers: novos,
        approval: {
          answered: aprovacoes.answered,
          approved: aprovacoes.approved,
          pending: pendentes,
          offeredCents: comDinheiro(Number(aprovacoes.offered)),
          approvedCents: comDinheiro(Number(aprovacoes.approved_value)),
        },
        topServices: usados
          .filter((linha) => linha.type === 'SERVICE')
          .slice(0, 5)
          .map((linha) => ({ name: linha.name, count: linha.count })),
        topParts: usados
          .filter((linha) => linha.type === 'PART')
          .slice(0, 5)
          .map((linha) => ({ name: linha.name, quantity: Number(linha.quantity) })),
      };
    });
  }

  /**
   * "Atenção necessária": o que está travado ou escapando, com caminho para
   * resolver. Grupo vazio não aparece — painel cheio de zero ensina a ignorar.
   */
  async attention(auth: AuthContext): Promise<DashboardAttention> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const agora = new Date();
      const timezone = await readTimezone(tx, auth.organizationId);
      const hoje = periodRange('today', timezone, undefined, agora);
      const vinteQuatroHoras = new Date(agora.getTime() - 24 * 60 * 60 * 1000);
      const doisDias = new Date(agora.getTime() - 2 * 24 * 60 * 60 * 1000);

      // sequencial pelo mesmo motivo do resumo: uma conexão, uma consulta por vez
      const organizationId = auth.organizationId;
      const orcamentos = await repo.orcamentosParados(tx, organizationId, vinteQuatroHoras);
      const vencidas = await repo.previsaoVencida(tx, organizationId, agora);
      const parados = await repo.prontoSemEntregar(tx, organizationId, doisDias);
      const devendo = await repo.entregueEmAberto(tx, organizationId);
      const estoque = await repo.estoqueEmFalta(tx, organizationId);
      const agendamentos = await repo.naoConfirmadosHoje(tx, organizationId, hoje);

      const dinheiro = veDinheiro(auth);
      const grupo = (
        key: AttentionGroup['key'],
        title: string,
        tone: AttentionGroup['tone'],
        linhas: repo.LinhaDeAtencao[],
        detalhe: (linha: repo.LinhaDeAtencao) => string,
        caminho: (linha: repo.LinhaDeAtencao) => string,
        verTodos: string | null,
      ): AttentionGroup | null => {
        if (!linhas.length) return null;
        return {
          key,
          title,
          tone,
          count: linhas[0]!.total,
          items: linhas.map((linha) => ({
            id: linha.id,
            label: linha.label,
            detail: detalhe(linha),
            to: caminho(linha),
          })),
          to: verTodos,
        };
      };

      const daOS = (linha: repo.LinhaDeAtencao) => `/ordens/${linha.number}`;
      const valor = (linha: repo.LinhaDeAtencao) =>
        dinheiro && linha.amount !== null ? formatBRL(Number(linha.amount)) : '';
      const juntar = (...partes: string[]) => partes.filter(Boolean).join(' · ');

      const grupos = [
        grupo(
          'QUOTES_UNSEEN',
          'Orçamentos que o cliente nem abriu',
          'danger',
          orcamentos.naoVistos,
          (l) => juntar(`enviado ${tempoDesde(l.since, agora)}`, 'não visualizado', valor(l)),
          daOS,
          '/orcamentos',
        ),
        grupo(
          'QUOTES_WAITING',
          'Orçamentos aguardando resposta',
          'warning',
          orcamentos.esperando,
          (l) => juntar(`enviado ${tempoDesde(l.since, agora)}`, valor(l)),
          daOS,
          '/orcamentos',
        ),
        grupo(
          'PROMISED_LATE',
          'Previsão de entrega vencida',
          'danger',
          vencidas,
          (l) => `prometido ${tempoDesde(l.since, agora)}`,
          daOS,
          '/ordens',
        ),
        grupo(
          'COMPLETED_NOT_DELIVERED',
          'Prontos e não entregues',
          'warning',
          parados,
          (l) => `finalizado ${tempoDesde(l.since, agora)}`,
          daOS,
          '/ordens?status=COMPLETED',
        ),
        grupo(
          'DELIVERED_UNPAID',
          'Entregues com saldo em aberto',
          'warning',
          devendo,
          (l) => juntar(valor(l) && `falta ${valor(l)}`, `entregue ${tempoDesde(l.since, agora)}`),
          daOS,
          '/ordens?status=DELIVERED',
        ),
        grupo(
          'STOCK',
          'Peças abaixo do mínimo ou negativas',
          'warning',
          estoque,
          (l) => `${Number(l.amount)} em estoque`,
          (l) => `/pecas/${l.id}`,
          '/pecas?estoque=atencao',
        ),
        grupo(
          'APPOINTMENTS_UNCONFIRMED',
          'Agendamentos de hoje sem confirmação',
          'info',
          agendamentos,
          (l) => (l.since ? `às ${formatMinutes(minutesOfDay(new Date(l.since), timezone))}` : ''),
          () => `/agenda?visao=dia&dia=${dayKey(agora, timezone)}`,
          '/agenda',
        ),
      ];

      return { groups: grupos.filter((g): g is AttentionGroup => g !== null) };
    });
  }

  /**
   * A série do gráfico, um ponto por dia do período — inclusive os dias sem
   * nada, que também são informação ("a semana morreu na quarta").
   */
  async chart(auth: AuthContext, query: ChartQuery): Promise<DashboardChart> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const agora = new Date();
      const { janela, info, timezone } = await this.periodo(tx, auth, query, agora);
      const org = auth.organizationId;

      const linhas = await (() => {
        switch (query.metric) {
          case 'revenue':
            return repo.serieDeOS(tx, org, janela, timezone, 'revenue');
          case 'work_orders':
            return repo.serieDeOS(tx, org, janela, timezone, 'count');
          case 'avg_ticket':
            return repo.serieDeOS(tx, org, janela, timezone, 'avg');
          case 'approval_rate':
            return repo.serieDeAprovacao(tx, org, janela, timezone);
          case 'new_customers':
            return repo.serieDeClientes(tx, org, janela, timezone);
        }
      })();

      const unit =
        query.metric === 'revenue' || query.metric === 'avg_ticket'
          ? 'money'
          : query.metric === 'approval_rate'
            ? 'percent'
            : 'count';
      // sem permissão de ver dinheiro, a série de dinheiro não existe
      const escondido = unit === 'money' && !veDinheiro(auth);
      const porDia = new Map(linhas.map((linha) => [linha.day, Number(linha.value)]));

      return {
        metric: query.metric,
        unit,
        period: info,
        points: escondido
          ? []
          : daysBetween(info.from, info.to).map((day) => ({ day, value: porDia.get(day) ?? 0 })),
      };
    });
  }

  /** O recorte do período, sempre no calendário da oficina. */
  private async periodo(
    tx: Tx,
    auth: AuthContext,
    query: DashboardQuery,
    agora: Date,
  ): Promise<{ janela: { from: Date; to: Date }; info: PeriodInfo; timezone: string }> {
    const timezone = await readTimezone(tx, auth.organizationId);
    const faixa = periodRange(query.period, timezone, { from: query.from, to: query.to }, agora);
    return {
      janela: { from: faixa.from, to: faixa.to },
      info: {
        period: query.period,
        from: faixa.fromDay,
        to: faixa.toDay,
        label: rotuloDoPeriodo(query.period, faixa.fromDay, faixa.toDay),
      },
      timezone,
    };
  }
}
