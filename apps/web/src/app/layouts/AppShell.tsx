import { can, type Permission } from '@oficinaos/shared';
import {
  CalendarDays,
  Car,
  ClipboardList,
  FileBarChart,
  FileText,
  House,
  Menu,
  Package,
  PhoneCall,
  Star,
  Target,
  ShoppingCart,
  Truck,
  Landmark,
  PanelLeftClose,
  Receipt,
  PanelLeftOpen,
  Settings,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router';
import { Brand } from '../../components/brand';
import { NotificationsBell } from '../../features/notifications/NotificationsBell';
import { Button } from '../../components/ui/button';
import { Sheet } from '../../components/ui/overlays';
import { cn } from '../../lib/cn';
import { useMe } from '../../lib/session';
import { usePersistentState } from '../../lib/use-persistent-state';
import { CommandMenu } from './CommandMenu';
import { CrumbProvider } from './crumbs';
import { Breadcrumbs, OrganizationSwitcher, ThemeToggle, TrialNotice, UserMenu } from './shell-parts';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  /** some do menu para quem não tem acesso (a API recusa de qualquer jeito) */
  permission?: Permission;
}

// Módulos entram aqui conforme existirem de verdade (clientes na E3, catálogo na E4, OS na E5…).
const NAV: NavItem[] = [
  { to: '/', label: 'Início', icon: House, end: true },
  { to: '/agenda', label: 'Agenda', icon: CalendarDays, permission: 'appointments:read' },
  { to: '/ordens', label: 'Ordens de serviço', icon: ClipboardList, permission: 'work_orders:read' },
  { to: '/orcamentos', label: 'Orçamentos', icon: FileText, permission: 'work_orders:read' },
  { to: '/clientes', label: 'Clientes', icon: Users },
  { to: '/veiculos', label: 'Veículos', icon: Car },
  { to: '/servicos', label: 'Serviços', icon: Wrench, permission: 'catalog:read' },
  { to: '/pecas', label: 'Peças e estoque', icon: Package, permission: 'catalog:read' },
  { to: '/fornecedores', label: 'Fornecedores', icon: Truck, permission: 'suppliers:read' },
  { to: '/compras', label: 'Compras', icon: ShoppingCart, permission: 'purchases:read' },
  { to: '/financeiro/receber', label: 'A receber', icon: Landmark, permission: 'finance:read' },
  { to: '/financeiro/pagar', label: 'A pagar', icon: Receipt, permission: 'finance:read' },
  { to: '/pos-venda', label: 'Pós-venda', icon: PhoneCall, permission: 'customers:view_contact' },
  { to: '/funil', label: 'Funil', icon: Target, permission: 'customers:view_contact' },
  { to: '/avaliacoes', label: 'Avaliações', icon: Star, permission: 'dashboard:view' },
  { to: '/relatorios', label: 'Relatórios', icon: FileBarChart, permission: 'reports:read' },
  { to: '/configuracoes', label: 'Configurações', icon: Settings },
];

function SidebarContent({ collapsed, onToggle, onNavigate }: {
  collapsed: boolean;
  onToggle?: () => void;
  onNavigate?: () => void;
}) {
  const { role } = useMe();
  const items = NAV.filter((item) => !item.permission || can(role, item.permission));
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

      <nav aria-label="Principal" className="flex flex-1 flex-col gap-0.5">
        {items.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={onNavigate}
            title={collapsed ? label : undefined}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
                isActive ? 'bg-surface-muted text-foreground' : 'text-muted hover:bg-surface-muted hover:text-foreground',
                collapsed && 'justify-center px-0',
              )
            }
          >
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            <span className={cn(collapsed && 'sr-only')}>{label}</span>
          </NavLink>
        ))}
      </nav>

      {!collapsed && <TrialNotice />}
    </div>
  );
}

export function AppShell() {
  const [collapsed, setCollapsed] = usePersistentState('oficinaos:sidebar-collapsed', false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <CrumbProvider>
    <div className="flex min-h-dvh">
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
            <NotificationsBell />
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
    </CrumbProvider>
  );
}
