import { NavLink } from 'react-router';
import { cn } from '../../lib/cn';

/**
 * Serviço e pacote são a mesma pergunta — "o que a oficina vende" — vistas de
 * duas alturas. O pacote mora ao lado do serviço, e não em um item de menu
 * novo: o menu enxuto da E23 não volta atrás.
 */
export function ServicesTabs() {
  const abas = [
    { to: '/servicos', label: 'Serviços', end: true },
    { to: '/servicos/pacotes', label: 'Pacotes' },
  ];

  return (
    <nav aria-label="Seções de serviços" className="mb-5 flex gap-1 overflow-x-auto border-b border-border">
      {abas.map((aba) => (
        <NavLink
          key={aba.to}
          to={aba.to}
          end={aba.end}
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
