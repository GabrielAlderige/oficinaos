import { REVIEW_STAR_LABELS } from '@oficinaos/shared';
import { Star } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Alert, Card, CardHeader, PageHeader, Skeleton } from '../../components/ui/display';
import { Field, fieldA11y } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { EmptyState } from '../../components/ui/list-parts';
import { errorMessage } from '../../lib/errors';
import { formatDate } from '../../lib/format';
import { useCan } from '../../lib/session';
import { useOrganizationSettings, useUpdateOrganizationSettings } from '../settings/api';
import { useReviewSummary } from './api';

/**
 * As avaliações (E16): a média que a oficina tem, o que os clientes
 * escreveram, e o link do Google para quem quiser avaliar lá também.
 *
 * O convite vai para TODO cliente com OS entregue — filtrar por quem parece
 * satisfeito é contra as regras do Google e não é honesto.
 */
export function ReviewsPage() {
  const resumo = useReviewSummary();
  const dados = resumo.data;
  const maior = Math.max(1, ...(dados?.distribution.map((linha) => linha.count) ?? [1]));

  return (
    <>
      <PageHeader title="Avaliações" description="O que os clientes acharam do atendimento, na nota deles." />

      {resumo.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : resumo.isError ? (
        <Alert variant="danger">{errorMessage(resumo.error)}</Alert>
      ) : dados ? (
        <div className="space-y-4">
          <Card>
            <div className="flex flex-wrap items-center gap-8 px-5 py-5">
              <div>
                <p className="text-sm text-muted">Média</p>
                <p className="mt-1 flex items-baseline gap-2 text-4xl font-semibold">
                  {dados.total ? dados.average.toLocaleString('pt-BR', { minimumFractionDigits: 1 }) : '–'}
                  <span className="text-base font-normal text-muted">
                    de {dados.total} {dados.total === 1 ? 'avaliação' : 'avaliações'}
                  </span>
                </p>
                {dados.pending > 0 && (
                  <p className="mt-1 text-xs text-muted">
                    {dados.pending} {dados.pending === 1 ? 'convite enviado sem resposta' : 'convites enviados sem resposta'}
                  </p>
                )}
              </div>
              <div className="min-w-56 flex-1">
                {[...dados.distribution].reverse().map((linha) => (
                  <div key={linha.rating} className="flex items-center gap-2 py-0.5 text-xs">
                    <span className="flex w-12 items-center gap-0.5 text-muted">
                      {linha.rating}
                      <Star className="size-3" aria-hidden="true" />
                    </span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-muted">
                      <span
                        className="block h-full rounded-full bg-accent-bright"
                        style={{ width: `${(linha.count / maior) * 100}%` }}
                      />
                    </span>
                    <span className="w-8 text-right tabular text-muted">{linha.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Últimas avaliações" description="Aparecem como o cliente escreveu — nada é aprovado antes." />
            {!dados.latest.length ? (
              <EmptyState
                icon={Star}
                title="Nenhuma avaliação ainda"
                description="Depois de entregar o carro, peça a avaliação na ficha da OS: o link vai pelo WhatsApp."
              />
            ) : (
              <ul className="divide-y divide-border">
                {dados.latest.map((avaliacao) => (
                  <li key={avaliacao.id} className="px-5 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{avaliacao.customerName}</span>
                      <span className="text-sm" aria-label={`${avaliacao.rating} de 5`}>
                        <span aria-hidden="true">{'★'.repeat(avaliacao.rating)}{'☆'.repeat(5 - avaliacao.rating)}</span>
                        <span className="ml-2 text-muted">{REVIEW_STAR_LABELS[avaliacao.rating]}</span>
                      </span>
                    </div>
                    {avaliacao.comment && <p className="mt-1 text-sm whitespace-pre-line">{avaliacao.comment}</p>}
                    <p className="mt-0.5 text-xs text-muted">
                      OS nº {avaliacao.workOrderNumber} · {formatDate(avaliacao.submittedAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <GoogleCard />
        </div>
      ) : null}
    </>
  );
}

/** O link do Google fica aqui, ao lado de onde ele é usado. */
function GoogleCard() {
  const podeConfigurar = useCan('organization:manage');
  const settings = useOrganizationSettings();
  const salvar = useUpdateOrganizationSettings();
  const [url, setUrl] = useState<string | null>(null);
  const valor = url ?? settings.data?.googleReviewUrl ?? '';

  if (!podeConfigurar) return null;

  return (
    <Card>
      <CardHeader
        title="Avaliar no Google"
        description="Depois de responder, o cliente vê um botão para avaliar também no Google. O convite é para todos, não só para quem deu nota alta — as políticas do Google proíbem filtrar."
      />
      <div className="flex flex-wrap items-end gap-3 px-5 py-4">
        <Field label="Link de avaliação do Perfil da Empresa" htmlFor="google-url" className="min-w-64 flex-1">
          <Input
            {...fieldA11y('google-url')}
            value={valor}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://g.page/r/..."
          />
        </Field>
        <Button
          loading={salvar.isPending}
          onClick={async () => {
            try {
              await salvar.mutateAsync({ googleReviewUrl: valor.trim() });
              toast.success('Link salvo.');
            } catch (err) {
              toast.error(errorMessage(err));
            }
          }}
        >
          Salvar
        </Button>
      </div>
    </Card>
  );
}
