import { can, type Permission } from '@oficinaos/shared';
import { CalendarDays, ClipboardList, House, Menu, MessageSquare, Wrench, type LucideIcon } from 'lucide-react';
import { NavLink } from 'react-router';
import { cn } from '../../lib/cn';
import { useMe } from '../../lib/session';

interface Atalho {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  permission?: Permission;
}

/**
 * A barra de baixo do celular (E24).
 *
 * Quem usa o sistema de pé na oficina não abre menu: toca no que está à mão.
 * São no máximo cinco destinos, escolhidos pelo papel — o mecânico começa em
 * "Minhas OS", quem administra começa no Início. O resto continua no menu
 * lateral, que vira gaveta pelo botão "Mais".
 *
 * Só aparece no celular: no computador, a barra lateral já faz esse papel.
 */
export function BottomNav({ onAbrirMenu }: { onAbrirMenu(): void }) {
  const { role } = useMe();
  const mecanico = role === 'MECHANIC';

  const primeiro: Atalho = mecanico
    ? { to: '/minhas-os', label: 'Minhas OS', icon: Wrench, permission: 'work_orders:read' }
    : { to: '/', label: 'Início', icon: House, end: true };
  const todos: Atalho[] = [
    primeiro,
    { to: '/agenda', label: 'Agenda', icon: CalendarDays, permission: 'appointments:read' },
    { to: '/ordens', label: 'OS', icon: ClipboardList, permission: 'work_orders:read' },
    { to: '/conversas', label: 'Conversas', icon: MessageSquare, permission: 'messages:send' },
  ];
  const atalhos = todos.filter((atalho) => !atalho.permission || can(role, atalho.permission));

  return (
    <nav
      aria-label="Atalhos"
      /* o padding de baixo respeita a barra do iPhone: sem ele, o dedo acerta
         o gesto de "voltar para a tela inicial" em vez do botão */
      className="sticky bottom-0 z-30 flex border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom,0px)] backdrop-blur lg:hidden"
    >
      {atalhos.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            cn(
              // 56px de alvo: dedo com luva de mecânico não acerta 32
              'flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-medium transition-colors',
              isActive ? 'text-accent dark:text-accent-bright' : 'text-muted',
            )
          }
        >
          <Icon className="size-5" aria-hidden="true" />
          {label}
        </NavLink>
      ))}
      <button
        type="button"
        onClick={onAbrirMenu}
        className="flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-medium text-muted"
      >
        <Menu className="size-5" aria-hidden="true" />
        Mais
      </button>
    </nav>
  );
}
