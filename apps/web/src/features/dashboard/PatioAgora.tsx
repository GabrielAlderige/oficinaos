import type { DashboardSummary } from '@oficinaos/shared';
import { CalendarDays, Car, FileText, PackageCheck, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router';
import { cn } from '../../lib/cn';

interface Pilar {
  label: string;
  valor: number;
  detalhe?: string;
  to: string;
  icone: LucideIcon;
  /** o número pede ação quando é maior que zero */
  destaque?: 'accent' | 'success' | 'warning';
}

/**
 * O pátio agora (E25).
 *
 * É a primeira coisa da tela porque é a primeira pergunta do dia: quantos
 * carros estão aqui, o que trava, o que já dá para entregar e quem chega hoje.
 * **Não depende do período escolhido** — "faturado em setembro" é história,
 * isto é o que está acontecendo — e por isso o cartão diz "agora" em cima.
 *
 * Cada número leva para a lista dele já filtrada: número que não abre nada é
 * número que a pessoa vai procurar de outro jeito.
 */
export function PatioAgora({ dados }: { dados: DashboardSummary }) {
  const prontos = dados.openByStatus.find((linha) => linha.status === 'COMPLETED')?.count ?? 0;
  const emExecucao = dados.openByStatus.find((linha) => linha.status === 'IN_PROGRESS')?.count ?? 0;

  const pilares: Pilar[] = [
    {
      label: 'Na oficina',
      valor: dados.vehiclesInShop,
      detalhe: emExecucao ? `${emExecucao} em execução` : 'nenhum em execução',
      to: '/ordens',
      icone: Car,
    },
    {
      label: 'Aguardando aprovação',
      valor: dados.awaitingApproval,
      detalhe: dados.approval.pending ? `${dados.approval.pending} sem resposta` : 'nenhum pendente',
      to: '/orcamentos',
      icone: FileText,
      destaque: 'warning',
    },
    {
      label: 'Prontos para entregar',
      valor: prontos,
      detalhe: prontos ? 'avise o cliente' : 'nada parado',
      to: '/ordens?status=COMPLETED',
      icone: PackageCheck,
      destaque: 'success',
    },
    {
      label: 'Agendados hoje',
      valor: dados.appointmentsToday,
      to: '/agenda?visao=dia',
      icone: CalendarDays,
    },
  ];

  return (
    <section aria-labelledby="patio-agora">
      <h2 id="patio-agora" className="mb-2 flex items-center gap-2 text-sm font-semibold">
        Agora na oficina
        <span className="text-xs font-normal text-muted">independe do período</span>
      </h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {pilares.map((pilar) => {
          const aceso = pilar.valor > 0 && pilar.destaque;
          return (
            <Link
              key={pilar.label}
              to={pilar.to}
              className={cn(
                'group rounded-xl border bg-surface p-4 shadow-xs transition-colors',
                aceso === 'warning' && 'border-warning/40 bg-warning-soft/40',
                aceso === 'success' && 'border-success/40 bg-success-soft/40',
                !aceso && 'border-border hover:border-accent-bright',
              )}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted">{pilar.label}</span>
                <pilar.icone
                  className={cn(
                    'size-4 shrink-0',
                    aceso === 'warning' ? 'text-warning' : aceso === 'success' ? 'text-success' : 'text-muted',
                  )}
                  aria-hidden="true"
                />
              </span>
              <span className="mt-1 block text-3xl font-semibold tracking-tight">{pilar.valor}</span>
              {pilar.detalhe && <span className="mt-0.5 block text-xs text-muted">{pilar.detalhe}</span>}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
