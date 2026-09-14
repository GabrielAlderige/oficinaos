import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { cn } from '../../lib/cn';

/**
 * Número solto não vira gráfico: um valor com rótulo é um **cartão**, e a
 * comparação entre eles fica a cargo dos gráficos (E9, Fase 3).
 *
 * O valor usa os algarismos normais da fonte, não `tabular-nums`: em tamanho
 * grande, dígito de largura fixa deixa "121" com buraco no meio. Tabular fica
 * para coluna de números, onde o alinhamento vertical importa.
 */
export function StatTile({
  label,
  value,
  hint,
  to,
  tone = 'neutral',
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  to?: string;
  tone?: 'neutral' | 'accent';
}) {
  const conteudo = (
    <>
      <p className="text-sm text-muted">{label}</p>
      <p className={cn('mt-1 text-2xl font-semibold', tone === 'accent' && 'text-accent')}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </>
  );
  const classe = 'rounded-lg border border-border bg-surface px-4 py-3';
  if (!to) return <div className={classe}>{conteudo}</div>;
  return (
    <Link to={to} className={cn(classe, 'block transition-colors hover:border-accent-bright')}>
      {conteudo}
    </Link>
  );
}

/**
 * O número que o painel lidera. Um por tela, de propósito: se tudo é destaque,
 * nada é. Quem não pode ver dinheiro lidera com o pátio, que é o trabalho dele.
 */
export function HeroFigure({
  label,
  value,
  hint,
  aside,
}: {
  label: string;
  value: string;
  hint?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <p className="text-sm text-muted">{label}</p>
        <p className="mt-0.5 text-4xl font-semibold sm:text-5xl">{value}</p>
        {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
      </div>
      {aside}
    </div>
  );
}
