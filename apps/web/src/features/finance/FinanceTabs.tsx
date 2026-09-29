import { NavLink } from 'react-router';
import { cn } from '../../lib/cn';

/**
 * As telas do dinheiro. "A pagar" deixou de ser uma lista inteira (E23): a
 * despesa se lança no fluxo de caixa, que é onde ela faz diferença. A comissão
 * entrou aqui (E26) porque é dinheiro saindo, e não uma configuração.
 */
export function FinanceTabs() {
  const abas = [
    { to: '/financeiro/receber', label: 'A receber' },
    { to: '/financeiro/caixa', label: 'Fluxo de caixa' },
    { to: '/financeiro/comissoes', label: 'Comissões' },
  ];

  return (
    <nav aria-label="Seções do financeiro" className="mb-5 flex gap-1 overflow-x-auto border-b border-border">
      {abas.map((aba) => (
        <NavLink
          key={aba.to}
          to={aba.to}
          className={({ isActive }) =>
            cn(
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors',
              isActive
                ? 'border-accent text-foreground dark:border-accent-bright'
                : 'border-transparent text-muted hover:text-foreground',
            )
          }
        >
          {aba.label}
        </NavLink>
      ))}
    </nav>
  );
}
