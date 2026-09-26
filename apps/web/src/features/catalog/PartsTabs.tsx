import { NavLink } from 'react-router';
import { cn } from '../../lib/cn';
import { useCan } from '../../lib/session';

/**
 * As duas telas de peça, lado a lado: o que tem na prateleira e o que está na
 * hora de pedir. Antes a segunda morava em "Compras → Sugestão de compra", a
 * três cliques de distância de quem cuida do estoque.
 */
export function PartsTabs() {
  const podeVerEstoque = useCan('inventory:read');

  const abas = [
    { to: '/pecas', label: 'Estoque', end: true, mostrar: true },
    { to: '/pecas/recomendacoes', label: 'Recomendações de pedido', mostrar: podeVerEstoque },
  ].filter((aba) => aba.mostrar);

  if (abas.length < 2) return null;

  return (
    <nav aria-label="Seções de peças e estoque" className="mb-5 flex gap-1 overflow-x-auto border-b border-border">
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
