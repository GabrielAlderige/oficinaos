import { npsGroup, NPS_GROUP_LABELS, type NpsGroup } from '@oficinaos/shared';
import { Link, useSearchParams } from 'react-router';
import { Smile } from 'lucide-react';
import { Alert, Badge, Card, CardHeader, Skeleton } from '../../components/ui/display';
import { EmptyState } from '../../components/ui/list-parts';
import { cn } from '../../lib/cn';
import { errorMessage } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';
import { useSatisfaction } from './api';

const TOM: Record<NpsGroup, 'success' | 'neutral' | 'danger'> = {
  PROMOTER: 'success',
  PASSIVE: 'neutral',
  DETRACTOR: 'danger',
};

/** As duas abas do Pós-venda: a fila de contatos e a satisfação (E49). */
export function AbasDoPosVenda() {
  const [params, setParams] = useSearchParams();
  const aba = params.get('aba') === 'satisfacao' ? 'satisfacao' : 'contatos';
  return (
    <nav aria-label="Seções do pós-venda" className="mb-5 flex gap-1 overflow-x-auto border-b border-border">
      {[
        { valor: 'contatos', rotulo: 'Contatos de hoje' },
        { valor: 'satisfacao', rotulo: 'Satisfação' },
      ].map((opcao) => (
        <button
          key={opcao.valor}
          type="button"
          aria-current={aba === opcao.valor ? 'page' : undefined}
          onClick={() => setParams(opcao.valor === 'contatos' ? new URLSearchParams() : new URLSearchParams({ aba: opcao.valor }))}
          className={cn(
            '-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors',
            aba === opcao.valor
              ? 'border-accent text-foreground dark:border-accent-bright'
              : 'border-transparent text-muted hover:text-foreground',
          )}
        >
          {opcao.rotulo}
        </button>
      ))}
    </nav>
  );
}

/**
 * A satisfação dos clientes (E49): o NPS, quantos de cada lado, e as últimas
 * respostas com o comentário. Nota de 0 a 6 aparece em vermelho — é o
 * cliente para ligar hoje.
 */
export function SatisfactionPanel() {
  const resumo = useSatisfaction();

  if (resumo.isPending) return <Skeleton className="h-64 w-full" />;
  if (resumo.isError) return <Alert variant="danger">{errorMessage(resumo.error)}</Alert>;
  const dados = resumo.data;

  if (!dados.answered) {
    return (
      <Card>
        <EmptyState
          icon={Smile}
          title="Nenhuma resposta ainda"
          description={
            dados.pending
              ? `${dados.pending} ${dados.pending === 1 ? 'cliente recebeu' : 'clientes receberam'} a pesquisa e ainda não ${dados.pending === 1 ? 'respondeu' : 'responderam'}.`
              : 'Depois de entregar o carro, toque em “Pesquisa de satisfação” na OS: o cliente responde de 0 a 10 pelo celular, e a nota aparece aqui.'
          }
        />
      </Card>
    );
  }

  const nps = dados.nps ?? 0;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-border bg-surface px-4 py-3">
          <p className="text-sm text-muted">NPS da oficina</p>
          <p className={cn('mt-1 text-3xl font-semibold tabular', nps >= 50 ? 'text-success' : nps < 0 ? 'text-danger' : '')}>
            {nps}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            de −100 a 100 · {dados.answered} {dados.answered === 1 ? 'resposta' : 'respostas'}
          </p>
        </div>
        <Contagem rotulo="Promotores (9 e 10)" valor={dados.promoters} total={dados.answered} tom="text-success" />
        <Contagem rotulo="Neutros (7 e 8)" valor={dados.passives} total={dados.answered} />
        <Contagem rotulo="Insatisfeitos (0 a 6)" valor={dados.detractors} total={dados.answered} tom="text-danger" />
      </div>

      <Card>
        <CardHeader
          title="Últimas respostas"
          description={
            dados.pending
              ? `E ${dados.pending} ${dados.pending === 1 ? 'pesquisa enviada ainda sem resposta' : 'pesquisas enviadas ainda sem resposta'}.`
              : 'Quem deu nota baixa merece uma ligação: é a chance de não perder o cliente.'
          }
        />
        <ul className="divide-y divide-border">
          {dados.recent.map((resposta) => {
            const grupo = npsGroup(resposta.score);
            return (
              <li key={resposta.id} className="flex gap-4 px-5 py-3">
                <span
                  className={cn(
                    'grid size-10 shrink-0 place-items-center rounded-full text-lg font-semibold tabular',
                    grupo === 'PROMOTER' ? 'bg-success-soft text-success' : grupo === 'DETRACTOR' ? 'bg-danger-soft text-danger' : 'bg-surface-muted',
                  )}
                  aria-label={`Nota ${resposta.score}`}
                >
                  {resposta.score}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium">{resposta.customerName}</span>
                    <Badge tone={TOM[grupo]}>{NPS_GROUP_LABELS[grupo]}</Badge>
                    <Link to={`/ordens/${resposta.workOrderNumber}`} className="text-xs text-muted hover:underline">
                      OS {resposta.workOrderNumber}
                    </Link>
                  </p>
                  {resposta.comment ? (
                    <p className="mt-1 text-sm">“{resposta.comment}”</p>
                  ) : (
                    <p className="mt-1 text-xs text-muted">Sem comentário.</p>
                  )}
                  <p className="mt-0.5 text-xs text-muted">{formatDateTime(resposta.submittedAt)}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}

function Contagem({ rotulo, valor, total, tom }: { rotulo: string; valor: number; total: number; tom?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-3">
      <p className="text-sm text-muted">{rotulo}</p>
      <p className={cn('mt-1 text-2xl font-semibold tabular', tom)}>{valor}</p>
      <p className="mt-0.5 text-xs text-muted">{total ? Math.round((valor / total) * 100) : 0}% das respostas</p>
    </div>
  );
}
