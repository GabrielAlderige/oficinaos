import { formatBRL, type DashboardPeriod, type DashboardSummary } from '@oficinaos/shared';
import { Link } from 'react-router';
import { Card } from '../../components/ui/display';
import { cn } from '../../lib/cn';

/**
 * O dinheiro do período (E25).
 *
 * Duas barras na MESMA escala em vez de dois números soltos: faturado e
 * recebido lado a lado mostram, de relance, o tamanho do fiado — que é a
 * pergunta que o dono faz de verdade ("vendi bem, mas entrou?").
 *
 * Não viram porcentagem de propósito. "Recebido" é o dinheiro que entrou no
 * período, e parte dele pode ser de OS de meses anteriores; dizer "78% do
 * faturado foi recebido" seria uma conta que não fecha. A comparação visual
 * conta a história sem afirmar o que não dá para afirmar.
 */
/** Como chamar o período de comparação, ao lado do valor dele. */
const ANTERIOR: Record<DashboardPeriod, string> = {
  today: 'ontem',
  week: 'semana passada',
  month: 'mês passado',
  last7: '7 dias antes',
  last30: '30 dias antes',
  custom: 'período anterior',
};

export function DinheiroDoPeriodo({ dados }: { dados: DashboardSummary }) {
  if (dados.billedCents === null) return null;
  const antes = ANTERIOR[dados.period.period];
  const comparacao = (valor: number | null) => (valor === null ? undefined : `${antes}: ${formatBRL(valor)}`);

  const faturado = dados.billedCents;
  const recebido = dados.receivedCents ?? 0;
  const maior = Math.max(faturado, recebido, 1);

  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 pt-4">
        <h2 className="text-sm font-semibold">Dinheiro — {dados.period.label}</h2>
        {dados.avgTicketCents !== null && (
          <p className="text-xs text-muted">
            ticket médio <span className="font-medium text-foreground">{formatBRL(dados.avgTicketCents)}</span>
          </p>
        )}
      </div>

      <div className="space-y-3 px-5 pt-3 pb-4">
        <Barra
          rotulo="Faturado"
          valor={faturado}
          proporcao={faturado / maior}
          detalhe={`${dados.completedOrders} ${dados.completedOrders === 1 ? 'OS finalizada' : 'OS finalizadas'}`}
          classe="bg-accent"
          comparacao={comparacao(dados.previous.billedCents)}
          destaque
        />
        {dados.receivedCents !== null && (
          <Barra
            rotulo="Recebido"
            valor={recebido}
            proporcao={recebido / maior}
            detalhe="dinheiro que entrou no caixa"
            classe="bg-success"
            comparacao={comparacao(dados.previous.receivedCents)}
            to="/financeiro/receber"
          />
        )}
      </div>

      <p className="border-t border-border px-5 py-2.5 text-xs text-muted">
        Faturar não é receber: o recebido inclui pagamentos de OS de outros períodos, e o fiado desta semana só
        aparece quando o cliente pagar.
      </p>
    </Card>
  );
}

function Barra({
  rotulo,
  valor,
  proporcao,
  detalhe,
  classe,
  comparacao,
  destaque = false,
  to,
}: {
  rotulo: string;
  valor: number;
  proporcao: number;
  detalhe: string;
  classe: string;
  /** o mesmo número no período anterior, para o "R$ 0,00" do dia 1º ter referência */
  comparacao?: string;
  destaque?: boolean;
  to?: string;
}) {
  const conteudo = (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-muted">{rotulo}</span>
        <span className={cn('font-semibold tracking-tight', destaque ? 'text-2xl sm:text-3xl' : 'text-xl')}>
          {formatBRL(valor)}
        </span>
      </div>
      {/* a barra é enfeite que carrega informação: a comparação entre as duas */}
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
        <div className={cn('h-full rounded-full', classe)} style={{ width: `${Math.max(2, proporcao * 100)}%` }} />
      </div>
      <p className="mt-1 flex flex-wrap justify-between gap-x-3 text-xs text-muted">
        <span>{detalhe}</span>
        {comparacao && <span className="tabular">{comparacao}</span>}
      </p>
    </>
  );

  if (!to) return <div>{conteudo}</div>;
  return (
    <Link to={to} className="block rounded-lg transition-opacity hover:opacity-80">
      {conteudo}
    </Link>
  );
}
