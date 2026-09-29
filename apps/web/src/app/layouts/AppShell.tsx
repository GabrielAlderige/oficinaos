import { can, type Permission } from '@oficinaos/shared';
import {
  CalendarDays,
  Car,
  ClipboardList,
  FileText,
  House,
  Menu,
  MessageSquare,
  Package,
  PhoneCall,
  Target,
  Landmark,
  PanelLeftClose,
  ReceiptText,
  PanelLeftOpen,
  Settings,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { Link, NavLink, Outlet, useMatches } from 'react-router';
import { Brand } from '../../components/brand';
import { NotificationsBell } from '../../features/notifications/NotificationsBell';
import { ReportsDialog } from '../../features/reports/ReportsDialog';
import { Button } from '../../components/ui/button';
import { Sheet } from '../../components/ui/overlays';
import { cn } from '../../lib/cn';
import { useMe } from '../../lib/session';
import { usePersistentState } from '../../lib/use-persistent-state';
import { BottomNav } from './BottomNav';
import { CommandMenu } from './CommandMenu';
import { DesktopHint } from './DesktopHint';
import { InstallPrompt } from './InstallPrompt';
import { CrumbProvider } from './crumbs';
import {
  Breadcrumbs,
  EmailVerificationNotice,
  OrganizationSwitcher,
  ThemeToggle,
  TrialNotice,
  UserMenu,
} from './shell-parts';

/** O que uma rota pode declarar no `handle` (ver `app/router.tsx`). */
interface Handle {
  /** ocupa a tela inteira, sem a largura de leitura (a conversa) */
  wide?: boolean;
  /** o nome da tela no aviso "fica melhor no computador" */
  desktop?: string;
}

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  /** some do menu para quem não tem acesso (a API recusa de qualquer jeito) */
  permission?: Permission;
}

interface NavGroup {
  /** o título da seção; vazio no primeiro grupo, que não precisa de nome */
  label?: string;
  items: NavItem[];
}

/**
 * O menu em quatro blocos, na ordem do dia de trabalho: o que está acontecendo
 * agora, quem são as pessoas e os carros, o que a oficina vende, e o dinheiro.
 *
 * Menu curto é escolha, não descuido: relatório virou botão no topo (abre por
 * cima, sem sair da tela), e o que era "Fornecedores", "Compras" e "A pagar"
 * saiu — a oficina registra a entrada de peça direto no estoque, com o custo.
 */
const NAV: NavGroup[] = [
  {
    items: [
      { to: '/', label: 'Início', icon: House, end: true },
      { to: '/agenda', label: 'Agenda', icon: CalendarDays, permission: 'appointments:read' },
      { to: '/ordens', label: 'Ordens de serviço', icon: ClipboardList, permission: 'work_orders:read' },
      { to: '/orcamentos', label: 'Orçamentos', icon: FileText, permission: 'work_orders:read' },
      { to: '/conversas', label: 'Conversas', icon: MessageSquare, permission: 'messages:send' },
    ],
  },
  {
    label: 'Clientes',
    items: [
      { to: '/clientes', label: 'Clientes', icon: Users },
      { to: '/veiculos', label: 'Veículos', icon: Car },
      { to: '/pos-venda', label: 'Pós-venda', icon: PhoneCall, permission: 'customers:view_contact' },
      { to: '/funil', label: 'Funil', icon: Target, permission: 'customers:view_contact' },
    ],
  },
  {
    label: 'Catálogo',
    items: [
      { to: '/servicos', label: 'Serviços', icon: Wrench, permission: 'catalog:read' },
      { to: '/pecas', label: 'Peças e estoque', icon: Package, permission: 'catalog:read' },
      /**
       * Ficha do carro no primeiro nível (E36). Estava como terceira aba
       * dentro de Peças e estoque: três toques para uma consulta que o
       * mecânico faz com a peça na mão. Sem permissão de propósito — quem
       * está de macacão precisa disto mais do que o dono.
       */
      { to: '/ficha-do-carro', label: 'Ficha do carro', icon: Car },
    ],
  },
  {
    label: 'Dinheiro',
    items: [
      { to: '/financeiro', label: 'Financeiro', icon: Landmark, permission: 'finance:read' },
      { to: '/notas', label: 'Notas fiscais', icon: ReceiptText, permission: 'invoices:read' },
    ],
  },
  { items: [{ to: '/configuracoes', label: 'Configurações', icon: Settings }] },
];

function SidebarContent({ collapsed, onToggle, onNavigate }: {
  collapsed: boolean;
  onToggle?: () => void;
  onNavigate?: () => void;
}) {
  const { role } = useMe();
  const grupos = NAV.map((grupo) => ({
    ...grupo,
    items: grupo.items.filter((item) => !item.permission || can(role, item.permission)),
  })).filter((grupo) => grupo.items.length > 0);
  return (
    <div className="flex h-full flex-col gap-4 p-3">
      <div className={cn('flex items-center justify-between gap-2 px-1 pt-1', collapsed && 'flex-col')}>
        <Link to="/" aria-label="OficinaOS, início" onClick={onNavigate}>
          <Brand compact={collapsed} />
        </Link>
        {onToggle && (
          <Button variant="ghost" size="icon" className="size-8" onClick={onToggle} aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}>
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </Button>
        )}
      </div>

      <OrganizationSwitcher collapsed={collapsed} />

      <nav aria-label="Principal" className="flex flex-1 flex-col gap-4 overflow-y-auto">
        {grupos.map((grupo, indice) => (
          <div key={grupo.label ?? indice} className="flex flex-col gap-0.5">
            {grupo.label && !collapsed && (
              <p className="px-2.5 pb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">
                {grupo.label}
              </p>
            )}
            {/* recolhido, a divisória faz o papel do título */}
            {grupo.label && collapsed && <div className="mx-auto mb-1 h-px w-6 bg-border" aria-hidden="true" />}
            {grupo.items.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                onClick={onNavigate}
                title={collapsed ? label : undefined}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-accent-soft text-foreground'
                      : 'text-muted hover:bg-surface-muted hover:text-foreground',
                    collapsed && 'justify-center px-0',
                  )
                }
              >
                <Icon className="size-4 shrink-0" aria-hidden="true" />
                <span className={cn(collapsed && 'sr-only')}>{label}</span>
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      {!collapsed && <TrialNotice />}
    </div>
  );
}

export function AppShell() {
  const [collapsed, setCollapsed] = usePersistentState('oficinaos:sidebar-collapsed', false);
  const [mobileOpen, setMobileOpen] = useState(false);
  // a conversa pede a tela inteira: coluna de contatos + fio, sem a largura de
  // leitura das outras telas e sem rolagem da página (quem rola é o fio)
  const matches = useMatches();
  const telaCheia = matches.some((match) => (match.handle as Handle | undefined)?.wide);
  // a tela que é larga demais para um celular avisa antes, em vez de abrir
  // apertada e deixar a pessoa descobrir sozinha (E24)
  const avisoDeDesktop = matches
    .map((match) => (match.handle as Handle | undefined)?.desktop)
    .filter((titulo): titulo is string => Boolean(titulo))
    .at(-1);

  return (
    <CrumbProvider>
    <div className={cn('flex min-h-dvh', telaCheia && 'h-dvh overflow-hidden')}>
      <aside
        className={cn(
          'sticky top-0 hidden h-dvh shrink-0 border-r border-border bg-surface transition-[width] duration-200 lg:block',
          collapsed ? 'w-[68px]' : 'w-60',
        )}
      >
        <SidebarContent collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />
      </aside>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen} title="Menu principal">
        <SidebarContent collapsed={false} onNavigate={() => setMobileOpen(false)} />
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background/85 px-4 backdrop-blur sm:px-6">
          <Button variant="ghost" size="icon" className="-ml-2 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Abrir menu">
            <Menu />
          </Button>
          <Breadcrumbs />
          <div className="ml-auto flex items-center gap-1.5">
            <CommandMenu />
            {/* relatório não é lugar onde se "fica": abre por cima e devolve a pessoa ao que estava fazendo */}
            <ReportsDialog />
            <NotificationsBell />
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>
        <main
          className={cn(
            'w-full flex-1',
            telaCheia
              ? 'min-h-0 overflow-hidden px-3 py-3 sm:px-4 sm:py-4'
              : 'mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:py-8',
          )}
        >
          {!telaCheia && <EmailVerificationNotice />}
          {avisoDeDesktop ? (
            <DesktopHint titulo={avisoDeDesktop}>
              <Outlet />
            </DesktopHint>
          ) : (
            <Outlet />
          )}
        </main>
        <InstallPrompt />
        <BottomNav onAbrirMenu={() => setMobileOpen(true)} />
      </div>
    </div>
    </CrumbProvider>
  );
}
