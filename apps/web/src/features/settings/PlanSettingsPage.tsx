import {
  BILLING_CYCLE_LABELS,
  formatBRL,
  mensalEquivalente,
  PAYMENT_ENVIRONMENT_LABELS,
  type BillingCycle,
  type BillingOverview,
  type PlanOption,
} from '@oficinaos/shared';
import { Check, FlaskConical } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Alert, Badge, Card, CardHeader, Skeleton } from '../../components/ui/display';
import { Input } from '../../components/ui/input';
import { ConfirmDialog } from '../../components/ui/overlays';
import { cn } from '../../lib/cn';
import { errorMessage } from '../../lib/errors';
import { formatDate } from '../../lib/format';
import { useBilling, useCancelSubscription, useChangePlan, useResumeSubscription, useSubscribe } from '../billing/api';

const NOME_DO_RECURSO: Record<string, string> = {
  quotes: 'Orçamento por link',
  appointments: 'Agenda',
  inventory: 'Estoque',
  suppliers: 'Fornecedores',
  purchasing: 'Compras',
  finance: 'Financeiro',
  reports: 'Relatórios',
  parts_search: 'Pesquisa de peças',
  automations: 'Automações',
  whatsapp_api: 'WhatsApp oficial',
  multi_branch: 'Multi-filial',
  custom_roles: 'Papéis customizados',
  public_api: 'API pública',
};

/**
 * O plano da oficina (E20): em que pé está a assinatura, quanto do plano ela
 * usa, e as portas para assinar, trocar, cancelar e voltar atrás.
 */
export function PlanSettingsPage() {
  const visao = useBilling();
  return visao.isPending ? (
    <Card className="space-y-4 p-6" aria-label="Carregando o plano">
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-full" />
    </Card>
  ) : visao.isError ? (
    <Alert variant="danger">{errorMessage(visao.error)}</Alert>
  ) : (
    <Conteudo dados={visao.data} />
  );
}

function Conteudo({ dados }: { dados: BillingOverview }) {
  const assinar = useSubscribe();
  const trocar = useChangePlan();
  const cancelar = useCancelSubscription();
  const voltar = useResumeSubscription();
  const [ciclo, setCiclo] = useState<BillingCycle>(dados.cycle);
  const [motivo, setMotivo] = useState('');
  const [confirmando, setConfirmando] = useState(false);
  // quem diz se já existe assinatura é a API (o gateway tem a referência),
  // não uma adivinhação da tela pelo preço preenchido
  const assinou = dados.subscribed;

  async function escolher(plano: PlanOption) {
    const acao = assinou ? 'trocar' : 'assinar';
    try {
      if (acao === 'assinar') {
        await assinar.mutateAsync({ clientRequestId: crypto.randomUUID(), plan: plano.code, cycle: ciclo });
        toast.success('Assinatura criada.');
      } else {
        await trocar.mutateAsync({ plan: plano.code, cycle: ciclo });
        toast.success(`Plano alterado para ${plano.name}.`);
      }
    } catch (erro) {
      toast.error(errorMessage(erro));
    }
  }

  return (
    <div className="space-y-6">
      {dados.environment === 'SIMULATOR' && (
        <Alert variant="warning">
          <span className="flex items-start gap-2">
            <FlaskConical className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              <strong>Cobrança em simulação.</strong> {PAYMENT_ENVIRONMENT_LABELS.SIMULATOR}. Dá para percorrer o fluxo
              inteiro — assinar, trocar de plano, cancelar — mas nenhuma cobrança é criada em gateway nenhum.
            </span>
          </span>
        </Alert>
      )}

      {dados.bloqueada && (
        <Alert variant="danger">
          <strong>Acesso limitado.</strong> A oficina continua com tudo salvo e visível, mas só volta a gravar depois
          de acertar a assinatura.
        </Alert>
      )}
      {dados.emCarencia && (
        <Alert variant="warning">
          Pagamento em aberto. A oficina continua trabalhando por mais {dados.diasRestantes}{' '}
          {dados.diasRestantes === 1 ? 'dia' : 'dias'}.
        </Alert>
      )}

      <Card>
        <CardHeader
          title={
            <span className="flex flex-wrap items-center gap-2">
              Plano {dados.planName}
              <Badge tone={dados.bloqueada ? 'danger' : dados.emTeste ? 'info' : 'success'}>
                {dados.emTeste
                  ? `Em teste — ${dados.diasRestantes} ${dados.diasRestantes === 1 ? 'dia' : 'dias'}`
                  : dados.status === 'ACTIVE'
                    ? 'Ativa'
                    : dados.status === 'PAST_DUE'
                      ? 'Pagamento em aberto'
                      : dados.status === 'CANCELED'
                        ? 'Cancelada'
                        : 'Expirada'}
              </Badge>
            </span>
          }
          description={
            dados.priceCents !== null
              ? `${formatBRL(dados.priceCents)} por ${dados.cycle === 'MONTHLY' ? 'mês' : 'ano'}`
              : 'Sem cobrança configurada ainda.'
          }
        />
        <div className="grid gap-4 px-5 pb-5 sm:grid-cols-2">
          <Uso
            rotulo="Pessoas na equipe"
            valor={dados.usage.users}
            teto={dados.usage.maxUsers}
          />
          <Uso
            rotulo="OS abertas no mês"
            valor={dados.usage.workOrdersThisMonth}
            teto={dados.usage.maxWorkOrdersPerMonth}
          />
          {dados.trabalhaAte && (
            <p className="text-sm text-muted sm:col-span-2">
              {dados.status === 'CANCELED'
                ? `Cancelada: a oficina trabalha até ${formatDate(dados.trabalhaAte)}.`
                : dados.emTeste
                  ? `O teste vai até ${formatDate(dados.trabalhaAte)}.`
                  : `Próxima renovação em ${formatDate(dados.trabalhaAte)}.`}
            </p>
          )}
          {dados.checkoutUrl && (
            <div className="sm:col-span-2">
              <Button asChild>
                <a href={dados.checkoutUrl} target="_blank" rel="noreferrer">
                  Abrir a página de pagamento
                </a>
              </Button>
            </div>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Planos"
          description="Trocar de plano vale na hora para os limites; o preço entra na próxima cobrança."
          action={
            <div className="flex rounded-md border border-border p-0.5" role="group" aria-label="Ciclo de cobrança">
              {(['MONTHLY', 'YEARLY'] as BillingCycle[]).map((opcao) => (
                <button
                  key={opcao}
                  type="button"
                  aria-pressed={ciclo === opcao}
                  onClick={() => setCiclo(opcao)}
                  className={cn(
                    'rounded px-3 py-1 text-sm',
                    ciclo === opcao ? 'bg-surface-muted font-medium' : 'text-muted hover:text-fg',
                  )}
                >
                  {BILLING_CYCLE_LABELS[opcao]}
                </button>
              ))}
            </div>
          }
        />
        <div className="grid gap-4 px-5 pb-5 lg:grid-cols-3">
          {dados.plans.map((plano) => {
            const preco = ciclo === 'MONTHLY' ? plano.priceMonthlyCents : plano.priceYearlyCents;
            return (
              <div
                key={plano.code}
                className={cn(
                  'flex flex-col gap-3 rounded-lg border p-4',
                  plano.current ? 'border-accent' : 'border-border',
                )}
              >
                <div>
                  <p className="flex items-center gap-2 font-medium">
                    {plano.name}
                    {plano.current && <Badge tone="accent">Atual</Badge>}
                  </p>
                  {preco === null ? (
                    <p className="mt-1 text-sm text-muted">Sem preço anual cadastrado.</p>
                  ) : (
                    <p className="mt-1">
                      <span className="text-2xl font-semibold tabular-nums">{formatBRL(preco)}</span>
                      <span className="text-sm text-muted">/{ciclo === 'MONTHLY' ? 'mês' : 'ano'}</span>
                      {ciclo === 'YEARLY' && (
                        <span className="block text-xs text-muted">
                          equivale a {formatBRL(mensalEquivalente(preco))} por mês
                        </span>
                      )}
                    </p>
                  )}
                </div>

                <ul className="flex-1 space-y-1 text-sm">
                  <li className="text-muted">
                    {plano.limits.maxUsers === null ? 'Usuários ilimitados' : `Até ${plano.limits.maxUsers} usuários`}
                  </li>
                  <li className="text-muted">
                    {plano.limits.maxWorkOrdersPerMonth === null
                      ? 'OS ilimitadas'
                      : `Até ${plano.limits.maxWorkOrdersPerMonth} OS por mês`}
                  </li>
                  {plano.features.map((recurso) => (
                    <li key={recurso} className="flex items-center gap-1.5">
                      <Check className="size-3.5 text-success" aria-hidden="true" />
                      {NOME_DO_RECURSO[recurso] ?? recurso}
                    </li>
                  ))}
                </ul>

                <Button
                  variant={plano.current ? 'secondary' : 'primary'}
                  disabled={preco === null || (plano.current && dados.cycle === ciclo) || assinar.isPending || trocar.isPending}
                  onClick={() => void escolher(plano)}
                >
                  {plano.current && dados.cycle === ciclo ? 'Plano atual' : assinou ? 'Mudar para este' : 'Assinar'}
                </Button>
              </div>
            );
          })}
        </div>
      </Card>

      {dados.payments.length > 0 && (
        <Card>
          <CardHeader title="Pagamentos" description="O histórico da assinatura desta oficina." />
          <table className="w-full text-sm">
            <thead className="border-y border-border text-left text-xs text-muted">
              <tr>
                <th className="px-5 py-2 font-medium">Vencimento</th>
                <th className="px-5 py-2 font-medium">Período</th>
                <th className="px-5 py-2 text-right font-medium">Valor</th>
                <th className="px-5 py-2 font-medium">Situação</th>
              </tr>
            </thead>
            <tbody>
              {dados.payments.map((pagamento) => (
                <tr key={pagamento.id} className="border-b border-border last:border-0">
                  <td className="px-5 py-2">{formatDate(`${pagamento.dueDate}T12:00:00`)}</td>
                  <td className="px-5 py-2 text-muted">
                    {pagamento.periodStart && pagamento.periodEnd
                      ? `${formatDate(`${pagamento.periodStart}T12:00:00`)} a ${formatDate(`${pagamento.periodEnd}T12:00:00`)}`
                      : '—'}
                  </td>
                  <td className="px-5 py-2 text-right tabular-nums">{formatBRL(pagamento.amountCents)}</td>
                  <td className="px-5 py-2">
                    <Badge tone={pagamento.status === 'PAID' ? 'success' : 'warning'}>
                      {pagamento.status === 'PAID' ? 'Pago' : pagamento.status}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Card>
        <CardHeader
          title={dados.status === 'CANCELED' ? 'Voltar a assinar' : 'Cancelar assinatura'}
          description={
            dados.status === 'CANCELED'
              ? 'A oficina continua trabalhando até o fim do período pago. Dá para voltar atrás a qualquer momento.'
              : 'Ao cancelar, a oficina continua trabalhando até o fim do período já pago. Os dados continuam aqui.'
          }
        />
        <div className="space-y-3 px-5 pb-5">
          {dados.status === 'CANCELED' ? (
            <Button
              disabled={voltar.isPending}
              onClick={async () => {
                try {
                  await voltar.mutateAsync();
                  toast.success('Assinatura reativada.');
                } catch (erro) {
                  toast.error(errorMessage(erro));
                }
              }}
            >
              Reativar assinatura
            </Button>
          ) : (
            <>
              <label className="block text-sm" htmlFor="motivo-cancelamento-plano">
                Motivo (opcional, ajuda a melhorar o produto)
              </label>
              <Input
                id="motivo-cancelamento-plano"
                className="max-w-md"
                value={motivo}
                onChange={(event) => setMotivo(event.target.value)}
              />
              <Button variant="danger" disabled={cancelar.isPending} onClick={() => setConfirmando(true)}>
                Cancelar assinatura
              </Button>
            </>
          )}
        </div>
      </Card>

      <ConfirmDialog
        open={confirmando}
        onOpenChange={setConfirmando}
        title="Cancelar a assinatura?"
        description="A oficina continua trabalhando até o fim do período já pago, e os dados continuam aqui. Depois disso, o painel fica só de leitura até você assinar de novo."
        confirmLabel="Cancelar assinatura"
        destructive
        onConfirm={async () => {
          try {
            await cancelar.mutateAsync({ reason: motivo.trim() || undefined });
            toast.success('Assinatura cancelada.');
            setMotivo('');
          } catch (erro) {
            toast.error(errorMessage(erro));
          }
        }}
      />
    </div>
  );
}

function Uso({ rotulo, valor, teto }: { rotulo: string; valor: number; teto: number | null }) {
  const proporcao = teto === null ? 0 : Math.min(100, Math.round((valor / teto) * 100));
  return (
    <div>
      <p className="flex justify-between text-sm">
        <span className="text-muted">{rotulo}</span>
        <span className="tabular-nums">
          {valor}
          {teto !== null && ` de ${teto}`}
        </span>
      </p>
      {teto !== null && (
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-muted">
          <div
            className={cn('h-full rounded-full', proporcao >= 100 ? 'bg-danger' : 'bg-accent')}
            style={{ width: `${Math.max(2, proporcao)}%` }}
          />
        </div>
      )}
    </div>
  );
}
