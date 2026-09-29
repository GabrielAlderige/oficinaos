import { formatBRL, formatBRLInput, parseBRL, type CommissionByMechanic, type CommissionReport } from '@oficinaos/shared';
import { HandCoins, Percent } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Alert, Avatar, Card, PageHeader, Skeleton } from '../../components/ui/display';
import { Field, fieldA11y } from '../../components/ui/field';
import { AdornedInput, Input, Textarea } from '../../components/ui/input';
import { EmptyState } from '../../components/ui/list-parts';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '../../components/ui/overlays';
import { cn } from '../../lib/cn';
import { errorMessage } from '../../lib/errors';
import { useCan } from '../../lib/session';
import { useCommissionReport, usePayCommission } from './api';
import { FinanceTabs } from './FinanceTabs';
import { dataBR } from './status';

const primeiroDiaDoMes = () => new Date().toISOString().slice(0, 8) + '01';
const hoje = () => new Date().toISOString().slice(0, 10);

/**
 * Comissão do mecânico (E26).
 *
 * A tela responde a uma pergunta só: **quanto eu devo pagar de comissão**. Por
 * isso o número grande é o **ganho** — o que o cliente já pagou —, e não a
 * comissão cheia das OS do período: comissão de fiado que não voltou é dívida
 * que a oficina ainda não tem.
 *
 * Cada mecânico abre e mostra OS por OS, com o que ela deve e o que entrou.
 * A conversa do fim do mês acontece sobre esta tela, não sobre uma planilha
 * paralela.
 */
export function CommissionsPage() {
  const podeGerir = useCan('commissions:manage');
  const [from, setFrom] = useState(primeiroDiaDoMes);
  const [to, setTo] = useState(hoje);
  const relatorio = useCommissionReport({ from, to });

  return (
    <>
      <PageHeader
        title="Comissões"
        description="Sobre a mão de obra dos serviços, conforme o cliente paga."
      />
      <FinanceTabs />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="De" htmlFor="comissao-de" className="w-40">
          <Input {...fieldA11y('comissao-de')} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="Até" htmlFor="comissao-ate" className="w-40">
          <Input {...fieldA11y('comissao-ate')} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <p className="pb-2 text-xs text-muted">Pelo dia em que a OS foi finalizada.</p>
      </div>

      {relatorio.isPending ? (
        <div className="space-y-3">
          {Array.from({ length: 2 }, (_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : relatorio.isError ? (
        <Alert variant="danger">{errorMessage(relatorio.error)}</Alert>
      ) : !relatorio.data.configured ? (
        <Card>
          <EmptyState
            icon={Percent}
            title="A oficina ainda não paga comissão"
            description="Defina o percentual padrão em Configurações → Preços e estoque. Cada mecânico e cada serviço podem ter o seu, e o mais específico vence."
            action={
              <Button asChild variant="secondary">
                <Link to="/configuracoes/precos">Configurar comissão</Link>
              </Button>
            }
          />
        </Card>
      ) : !relatorio.data.mechanics.length ? (
        <Card>
          <EmptyState
            icon={HandCoins}
            title="Nenhuma comissão no período"
            description="A comissão nasce quando a OS é finalizada com um mecânico responsável. Troque as datas para procurar em outro mês."
          />
        </Card>
      ) : (
        <div className="space-y-4">
          <Totais dados={relatorio.data} />
          <ul className="space-y-3">
            {relatorio.data.mechanics.map((mecanico) => (
              <li key={mecanico.mechanicUserId}>
                <CartaoDoMecanico mecanico={mecanico} periodo={{ from, to }} podeGerir={podeGerir} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function Totais({ dados }: { dados: CommissionReport }) {
  const aPagar = Math.max(0, dados.totals.earnedCents - dados.totals.paidOutCents);
  return (
    <Card>
      <div className="grid gap-4 p-5 sm:grid-cols-3">
        <div>
          <p className="text-sm text-muted">A pagar no período</p>
          <p className="mt-1 text-3xl font-semibold tracking-tight">{formatBRL(aPagar)}</p>
          <p className="mt-0.5 text-xs text-muted">ganho menos o que você já pagou</p>
        </div>
        <div>
          <p className="text-sm text-muted">Já ganho</p>
          <p className="mt-1 text-xl font-semibold tabular">{formatBRL(dados.totals.earnedCents)}</p>
          <p className="mt-0.5 text-xs text-muted">proporcional ao que o cliente pagou</p>
        </div>
        <div>
          <p className="text-sm text-muted">Se tudo for recebido</p>
          <p className="mt-1 text-xl font-semibold tabular text-muted">{formatBRL(dados.totals.fullCommissionCents)}</p>
          <p className="mt-0.5 text-xs text-muted">comissão cheia das OS do período</p>
        </div>
      </div>
    </Card>
  );
}

function CartaoDoMecanico({
  mecanico,
  periodo,
  podeGerir,
}: {
  mecanico: CommissionByMechanic;
  periodo: { from: string; to: string };
  podeGerir: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const [pagando, setPagando] = useState(false);
  const aPagar = Math.max(0, mecanico.earnedCents - mecanico.paidOutCents);

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3 px-5 py-4">
        <Avatar name={mecanico.mechanicName} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{mecanico.mechanicName}</p>
          <p className="text-xs text-muted">
            {mecanico.orders.length} {mecanico.orders.length === 1 ? 'OS' : 'OS'} · mão de obra{' '}
            {formatBRL(mecanico.laborCents)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xl font-semibold tabular">{formatBRL(aPagar)}</p>
          <p className="text-xs text-muted">
            ganho {formatBRL(mecanico.earnedCents)}
            {mecanico.paidOutCents > 0 && ` · pago ${formatBRL(mecanico.paidOutCents)}`}
          </p>
        </div>
        {podeGerir && aPagar > 0 && (
          <Button size="sm" onClick={() => setPagando(true)}>
            <HandCoins />
            Registrar pagamento
          </Button>
        )}
        <Button size="sm" variant="ghost" aria-expanded={aberto} onClick={() => setAberto(!aberto)}>
          {aberto ? 'Fechar' : 'Ver as OS'}
        </Button>
      </div>

      {aberto && (
        <div className="overflow-x-auto border-t border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted">
                <th scope="col" className="px-5 py-2 text-left font-medium">
                  OS
                </th>
                <th scope="col" className="px-3 py-2 text-left font-medium">
                  Finalizada
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Total
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Pago
                </th>
                <th scope="col" className="px-5 py-2 text-right font-medium">
                  Comissão
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {mecanico.orders.map((ordem) => {
                const quitada = ordem.paidCents >= ordem.dueCents;
                return (
                  <tr key={ordem.workOrderId}>
                    <td className="px-5 py-2">
                      <Link to={`/ordens/${ordem.number}`} className="font-medium hover:underline">
                        OS {ordem.number}
                      </Link>
                      <span className="block truncate text-xs text-muted">
                        {ordem.customerName} · {ordem.vehicleLabel}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-muted tabular">
                      {ordem.deliveredAt ? dataBR(ordem.deliveredAt.slice(0, 10)) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular">{formatBRL(ordem.dueCents)}</td>
                    <td className={cn('px-3 py-2 text-right tabular', !quitada && 'text-warning')}>
                      {formatBRL(ordem.paidCents)}
                    </td>
                    <td className="px-5 py-2 text-right">
                      <span className="font-medium tabular">{formatBRL(ordem.earnedCents)}</span>
                      {!quitada && (
                        <span className="block text-xs text-muted">de {formatBRL(ordem.fullCommissionCents)}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="border-t border-border px-5 py-2.5 text-xs text-muted">
            A comissão entra conforme o cliente paga: OS em aberto aparece com o valor proporcional, e completa quando
            ela for quitada.
          </p>
        </div>
      )}

      <PagamentoDialog
        aberto={pagando}
        onFechar={() => setPagando(false)}
        mecanico={mecanico}
        periodo={periodo}
        sugestao={aPagar}
      />
    </Card>
  );
}

function PagamentoDialog({
  aberto,
  onFechar,
  mecanico,
  periodo,
  sugestao,
}: {
  aberto: boolean;
  onFechar(): void;
  mecanico: CommissionByMechanic;
  periodo: { from: string; to: string };
  sugestao: number;
}) {
  const pagar = usePayCommission();
  const [valor, setValor] = useState(() => formatBRLInput(sugestao));
  const [notas, setNotas] = useState('');

  return (
    <Dialog open={aberto} onOpenChange={(estado) => !estado && onFechar()}>
      <DialogContent>
        <DialogHeader
          title={`Pagar comissão de ${mecanico.mechanicName}`}
          description={`Período de ${dataBR(periodo.from)} a ${dataBR(periodo.to)}.`}
        />
        <div className="space-y-4">
          <Field label="Valor pago" htmlFor="comissao-valor" hint={`Sugerido: ${formatBRL(sugestao)}`}>
            <AdornedInput
              leading="R$"
              {...fieldA11y('comissao-valor', undefined, true)}
              inputMode="decimal"
              value={valor}
              onChange={(event) => setValor(event.target.value)}
            />
          </Field>
          <Field label="Observação" htmlFor="comissao-nota" hint="Opcional. Ex.: adiantamento, desconto de vale.">
            <Textarea
              {...fieldA11y('comissao-nota', undefined, true)}
              rows={2}
              value={notas}
              onChange={(event) => setNotas(event.target.value)}
            />
          </Field>
          <Alert variant="info">
            Isto registra que <strong>você pagou</strong> a comissão. O cálculo continua vindo do que o cliente pagou —
            os dois números ficam lado a lado.
          </Alert>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onFechar}>
            Cancelar
          </Button>
          <Button
            loading={pagar.isPending}
            onClick={async () => {
              const centavos = parseBRL(valor);
              if (!centavos || centavos <= 0) {
                toast.error('Informe o valor pago.');
                return;
              }
              try {
                await pagar.mutateAsync({
                  mechanicUserId: mecanico.mechanicUserId,
                  periodFrom: periodo.from,
                  periodTo: periodo.to,
                  amountCents: centavos,
                  notes: notas.trim() || undefined,
                });
                toast.success(`Comissão de ${mecanico.mechanicName} registrada.`);
                onFechar();
              } catch (erro) {
                toast.error(errorMessage(erro));
              }
            }}
          >
            Registrar pagamento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
