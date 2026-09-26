import type { DashboardSummary } from '@oficinaos/shared';
import { Card } from '../../components/ui/display';

/** "8 de 10" vira "80%"; sem resposta nenhuma, não inventa porcentagem. */
const taxa = (dados: DashboardSummary): string =>
  dados.approval.answered ? `${Math.round((dados.approval.approved / dados.approval.answered) * 100)}%` : '—';

/**
 * O que a oficina produziu no período (E25).
 *
 * Eram quatro cartões grandes competindo com o dinheiro e com o pátio. Viraram
 * uma lista: esses números são para **conferir**, não para monitorar — a
 * pessoa olha uma vez por semana, não a cada meia hora. Peso visual baixo é a
 * informação de que eles não são urgentes.
 */
export function ProducaoDoPeriodo({ dados }: { dados: DashboardSummary }) {
  const linhas: { label: string; valor: string; detalhe?: string }[] = [
    {
      label: 'Serviços concluídos',
      valor: String(dados.completedServices),
      detalhe: `${dados.completedOrders} OS · ${dados.vehiclesServed} ${dados.vehiclesServed === 1 ? 'veículo' : 'veículos'}`,
    },
    {
      label: 'Orçamentos aprovados',
      valor: taxa(dados),
      detalhe: dados.approval.answered
        ? `${dados.approval.approved} de ${dados.approval.answered} respondidos`
        : 'sem resposta no período',
    },
    { label: 'Clientes novos', valor: String(dados.newCustomers) },
  ];

  return (
    <Card>
      <h2 className="px-5 pt-4 text-sm font-semibold">Produção — {dados.period.label}</h2>
      <dl className="divide-y divide-border px-5 pb-1">
        {linhas.map((linha) => (
          <div key={linha.label} className="flex items-baseline justify-between gap-4 py-3">
            <dt className="min-w-0">
              <span className="block text-sm">{linha.label}</span>
              {linha.detalhe && <span className="block text-xs text-muted">{linha.detalhe}</span>}
            </dt>
            <dd className="shrink-0 text-lg font-semibold tabular">{linha.valor}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
