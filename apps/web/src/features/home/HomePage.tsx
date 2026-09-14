import {
  DASHBOARD_PERIOD_LABELS,
  formatBRL,
  WORK_ORDER_STATUS_LABELS,
  type DashboardPeriod,
  type DashboardSummary,
} from '@oficinaos/shared';
import { useSearchParams } from 'react-router';
import { Alert, Card, CardHeader, PageHeader, Skeleton } from '../../components/ui/display';
import { cn } from '../../lib/cn';
import { firstName } from '../../lib/format';
import { useCan, useMe } from '../../lib/session';
import { AttentionPanel } from '../dashboard/AttentionPanel';
import { useDashboardSummary } from '../dashboard/api';
import { MetricChart } from '../dashboard/MetricChart';
import { HeroFigure, StatTile } from '../dashboard/StatTile';
import { SetupChecklist } from './SetupChecklist';

const PERIODOS: DashboardPeriod[] = ['today', 'week', 'month'];
const ehPeriodo = (valor: string | null): valor is DashboardPeriod =>
  PERIODOS.includes(valor as DashboardPeriod);

/** "8 de 10" vira "80%"; sem resposta nenhuma, não inventa porcentagem. */
function taxa(dados: DashboardSummary): string {
  if (!dados.approval.answered) return '—';
  return `${Math.round((dados.approval.approved / dados.approval.answered) * 100)}%`;
}

function Numeros({ dados }: { dados: DashboardSummary }) {
  const naOficina = dados.openByStatus.filter((linha) => linha.count > 0);
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile
          label="Veículos na oficina"
          value={dados.vehiclesInShop}
          hint={naOficina
            .slice(0, 2)
            .map((linha) => `${linha.count} ${WORK_ORDER_STATUS_LABELS[linha.status].toLowerCase()}`)
            .join(' · ')}
          to="/ordens"
        />
        <StatTile
          label="Aguardando aprovação"
          value={dados.awaitingApproval}
          hint={dados.approval.pending ? `${dados.approval.pending} orçamento(s) sem resposta` : undefined}
          to="/orcamentos"
          tone={dados.awaitingApproval > 0 ? 'accent' : 'neutral'}
        />
        <StatTile
          label="Agendamentos de hoje"
          value={dados.appointmentsToday}
          to="/agenda?visao=dia"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {dados.receivedCents !== null && (
          <StatTile label="Recebido no período" value={formatBRL(dados.receivedCents)} />
        )}
        {dados.avgTicketCents !== null && (
          <StatTile label="Ticket médio" value={formatBRL(dados.avgTicketCents)} />
        )}
        <StatTile
          label="Serviços concluídos"
          value={dados.completedServices}
          hint={`${dados.completedOrders} OS · ${dados.vehiclesServed} veículo(s)`}
        />
        <StatTile
          label="Taxa de aprovação"
          value={taxa(dados)}
          hint={dados.approval.answered ? `${dados.approval.approved} de ${dados.approval.answered} respondidos` : 'sem resposta no período'}
        />
      </div>
    </>
  );
}

/** Os dois mais usados do período, lado a lado. Lista curta: é resumo, não relatório. */
function MaisUsados({ dados }: { dados: DashboardSummary }) {
  if (!dados.topServices.length && !dados.topParts.length) return null;
  const colunas = [
    { titulo: 'Serviços mais feitos', linhas: dados.topServices.map((s) => ({ nome: s.name, valor: `${s.count}×` })) },
    {
      titulo: 'Peças mais usadas',
      linhas: dados.topParts.map((p) => ({ nome: p.name, valor: `${p.quantity.toLocaleString('pt-BR')}` })),
    },
  ].filter((coluna) => coluna.linhas.length);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {colunas.map((coluna) => (
        <Card key={coluna.titulo}>
          <CardHeader title={coluna.titulo} />
          <ul className="divide-y divide-border border-t border-border">
            {coluna.linhas.map((linha) => (
              <li key={linha.nome} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                <span className="min-w-0 truncate">{linha.nome}</span>
                <span className="shrink-0 tabular-nums text-muted">{linha.valor}</span>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}

/**
 * O painel de Início (E9). A ordem é a da oficina: primeiro o que ela vendeu no
 * período, depois o pátio de hoje, e então **o que está travado**. Os primeiros
 * passos ficam por último e somem quando terminam.
 */
export function HomePage() {
  const me = useMe();
  const podeVer = useCan('dashboard:view');
  const [params, setParams] = useSearchParams();
  const escolhido = params.get('periodo');
  const periodo: DashboardPeriod = ehPeriodo(escolhido) ? escolhido : 'month';
  const resumo = useDashboardSummary({ period: periodo }, podeVer);
  const dados = resumo.data;

  const trocarPeriodo = (valor: DashboardPeriod) => {
    const proximo = new URLSearchParams(params);
    if (valor === 'month') proximo.delete('periodo');
    else proximo.set('periodo', valor);
    setParams(proximo, { replace: true });
  };

  return (
    <>
      <PageHeader
        title={`Olá, ${firstName(me.user.name)}`}
        description={`Você está no painel da ${me.organization.name}.`}
        actions={
          podeVer && (
            <div className="flex rounded-md border border-border p-0.5" role="group" aria-label="Período">
              {PERIODOS.map((opcao) => (
                <button
                  key={opcao}
                  type="button"
                  aria-pressed={periodo === opcao}
                  onClick={() => trocarPeriodo(opcao)}
                  className={cn(
                    'rounded px-3 py-1 text-sm',
                    periodo === opcao ? 'bg-surface-muted font-medium' : 'text-muted hover:text-fg',
                  )}
                >
                  {DASHBOARD_PERIOD_LABELS[opcao]}
                </button>
              ))}
            </div>
          )
        }
      />

      <div className="space-y-4">
        {podeVer && resumo.isError && (
          <Alert variant="danger">Não deu para carregar os números. Atualize a página.</Alert>
        )}
        {podeVer && !dados && !resumo.isError && (
          <>
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-20 w-full" />
          </>
        )}
        {dados && (
          <>
            <Card className="px-5 py-4">
              <HeroFigure
                label={
                  dados.billedCents !== null
                    ? `Faturado — ${dados.period.label}`
                    : `Veículos na oficina — ${dados.period.label}`
                }
                value={
                  dados.billedCents !== null ? formatBRL(dados.billedCents) : String(dados.vehiclesInShop)
                }
                hint={
                  dados.billedCents !== null
                    ? `${dados.completedOrders} OS finalizada(s) no período · faturar não é receber`
                    : `${dados.completedOrders} OS finalizada(s) no período`
                }
              />
            </Card>
            <Numeros dados={dados} />
            <AttentionPanel />
            <MetricChart periodo={{ period: periodo }} podeVerDinheiro={dados.billedCents !== null} />
            <MaisUsados dados={dados} />
          </>
        )}
        <SetupChecklist />
      </div>
    </>
  );
}
