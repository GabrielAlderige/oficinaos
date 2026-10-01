import { DASHBOARD_PERIOD_LABELS, type DashboardPeriod, type DashboardSummary } from '@oficinaos/shared';
import { CalendarDays, ClipboardPlus, UserPlus } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { Button } from '../../components/ui/button';
import { Alert, Card, CardHeader, Skeleton } from '../../components/ui/display';
import { cn } from '../../lib/cn';
import { firstName } from '../../lib/format';
import { useCan, useMe } from '../../lib/session';
import { AttentionPanel } from '../dashboard/AttentionPanel';
import { useDashboardSummary } from '../dashboard/api';
import { DinheiroDoPeriodo } from '../dashboard/DinheiroDoPeriodo';
import { MetricChart } from '../dashboard/MetricChart';
import { PatioAgora } from '../dashboard/PatioAgora';
import { ProducaoDoPeriodo } from '../dashboard/ProducaoDoPeriodo';
import { SetupChecklist } from './SetupChecklist';

const PERIODOS: DashboardPeriod[] = ['today', 'week', 'month'];
const ehPeriodo = (valor: string | null): valor is DashboardPeriod =>
  PERIODOS.includes(valor as DashboardPeriod);

const diaDeHoje = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
const comMaiuscula = (texto: string) => texto.charAt(0).toUpperCase() + texto.slice(1);

/**
 * O painel de Início (E9, redesenhado na E25).
 *
 * A ordem é a das perguntas de quem abre a oficina de manhã:
 *
 * 1. **O que está aqui agora?** — o pátio, que não depende do período;
 * 2. **O que precisa de mim?** — o que travou, com caminho para resolver;
 * 3. **Como foi o período?** — dinheiro, gráfico e produção, nessa ordem de
 *    peso visual.
 *
 * No celular essa é a ordem de cima para baixo (a pessoa lê os dois primeiros
 * e já sabe o dia). No computador, o que exige ação fica na coluna da direita,
 * sempre à vista, e os números ocupam a coluna larga.
 *
 * Antes eram oito cartões do mesmo tamanho: sem hierarquia, o olho não sabia
 * onde pousar, e o que pedia ação estava no fim da rolagem.
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
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Olá, {firstName(me.user.name)}</h1>
        <p className="text-sm text-muted">
          {comMaiuscula(diaDeHoje.format(new Date()))} · {me.organization.name}
        </p>
      </header>

      <AcoesRapidas />

      {podeVer && resumo.isError && (
        <Alert variant="danger">Não deu para carregar os números. Atualize a página.</Alert>
      )}
      {podeVer && !dados && !resumo.isError && (
        <div className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      )}

      {dados && (
        <div className="space-y-4">
          <PatioAgora dados={dados} />

          {/*
            No celular vale a ordem do DOM: o que pede ação vem logo depois do
            pátio. No computador o `order` troca as colunas — os números à
            esquerda, o que precisa de gente à direita, sem rolar.
          */}
          <div className="grid gap-4 lg:grid-cols-3 lg:items-start">
            {/*
              `min-w-0` nas duas colunas porque filho de grid nasce com
              `min-width: auto` e se recusa a encolher abaixo do conteúdo: um
              único trecho sem onde quebrar trava a coluna e o painel passa a
              rolar de lado, sem nada no CSS dela indicando largura.

              Não foi isto que causou o estouro de 438px que o teste pegou (era
              a tabela de leitor de tela do gráfico), mas é a rede que impede o
              próximo conteúdo comprido de fazer o mesmo.
            */}
            <div className="min-w-0 space-y-4 lg:order-2">
              <AttentionPanel />
            </div>

            <div className="min-w-0 space-y-4 lg:order-1 lg:col-span-2">
              <PeriodoEscolhido periodo={periodo} onTrocar={trocarPeriodo} />
              <DinheiroDoPeriodo dados={dados} />
              <MetricChart periodo={{ period: periodo }} podeVerDinheiro={dados.billedCents !== null} />
              <ProducaoDoPeriodo dados={dados} />
              <MaisUsados dados={dados} />
              {/* os primeiros passos são de quem está começando: ficam no fim,
                  e somem sozinhos quando a oficina termina a configuração */}
              <SetupChecklist />
            </div>
          </div>
        </div>
      )}

      {!dados && <SetupChecklist />}
    </>
  );
}

/** O seletor de período, junto do que ele muda — e não perdido no cabeçalho. */
function PeriodoEscolhido({
  periodo,
  onTrocar,
}: {
  periodo: DashboardPeriod;
  onTrocar(valor: DashboardPeriod): void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted">Mostrando</span>
      <div className="flex rounded-lg border border-border bg-surface p-0.5" role="group" aria-label="Período">
        {PERIODOS.map((opcao) => (
          <button
            key={opcao}
            type="button"
            aria-pressed={periodo === opcao}
            onClick={() => onTrocar(opcao)}
            className={cn(
              'rounded-md px-3 py-1 text-sm transition-colors',
              periodo === opcao ? 'bg-accent-soft font-medium text-foreground' : 'text-muted hover:text-foreground',
            )}
          >
            {DASHBOARD_PERIOD_LABELS[opcao]}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * O que a oficina faz dez vezes por dia, a um clique da tela inicial. Antes
 * era: abrir o menu, achar a seção, abrir a lista, achar o botão — quatro
 * passos para começar uma OS.
 */
function AcoesRapidas() {
  const podeOS = useCan('work_orders:write');
  const podeAgenda = useCan('appointments:write');
  const podeCliente = useCan('customers:write');

  const acoes = [
    { to: '/ordens/nova', label: 'Nova OS', icon: ClipboardPlus, mostrar: podeOS, principal: true },
    { to: '/agenda', label: 'Agenda de hoje', icon: CalendarDays, mostrar: podeAgenda, principal: false },
    { to: '/clientes?novo=1', label: 'Novo cliente', icon: UserPlus, mostrar: podeCliente, principal: false },
  ].filter((acao) => acao.mostrar);

  if (!acoes.length) return null;

  return (
    <div className="mb-4 flex flex-wrap gap-2">
      {acoes.map((acao) => (
        <Button key={acao.to} asChild variant={acao.principal ? 'primary' : 'secondary'}>
          <Link to={acao.to}>
            <acao.icon />
            {acao.label}
          </Link>
        </Button>
      ))}
    </div>
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
                <span className="shrink-0 text-muted tabular-nums">{linha.valor}</span>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}
