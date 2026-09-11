import { ROLE_LABELS } from '@oficinaos/shared';
import { Check, ChevronRight, ChevronsUpDown, LogOut, Moon, ShieldCheck, Sun } from 'lucide-react';
import { useState } from 'react';
import { Link, useMatches, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Avatar } from '../../components/ui/display';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/overlays';
import { cn } from '../../lib/cn';
import { errorMessage } from '../../lib/errors';
import { formatDate, initials } from '../../lib/format';
import { useMe, useSession } from '../../lib/session';
import { useTheme } from '../../lib/theme';
import { useCrumbLabels } from './crumbs';

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <Button variant="ghost" size="icon" onClick={toggle} aria-label={theme === 'dark' ? 'Usar tema claro' : 'Usar tema escuro'}>
      {theme === 'dark' ? <Sun /> : <Moon />}
    </Button>
  );
}

export function Breadcrumbs() {
  const labels = useCrumbLabels();
  const crumbs = useMatches()
    .map((match) => ({
      path: match.pathname,
      label: labels[match.pathname] ?? (match.handle as { crumb?: string } | undefined)?.crumb,
    }))
    .filter((c): c is { path: string; label: string } => Boolean(c.label))
    .filter((c, i, all) => all.findIndex((x) => x.path === c.path) === i);
  return (
    <nav aria-label="Trilha de navegação" className="min-w-0">
      <ol className="flex items-center gap-1.5 text-sm">
        {crumbs.map((crumb, i) => (
          <li key={crumb.path} className="flex min-w-0 items-center gap-1.5">
            {i > 0 && <ChevronRight className="size-3.5 shrink-0 text-muted" aria-hidden="true" />}
            {i === crumbs.length - 1 ? (
              <span aria-current="page" className="truncate font-medium">
                {crumb.label}
              </span>
            ) : (
              <Link to={crumb.path} className="truncate text-muted hover:text-foreground">
                {crumb.label}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Seletor de oficina: só vira menu para quem participa de mais de uma. */
export function OrganizationSwitcher({ collapsed }: { collapsed: boolean }) {
  const me = useMe();
  const { switchOrganization } = useSession();
  const navigate = useNavigate();
  const [switching, setSwitching] = useState(false);
  const multiple = me.organizations.length > 1;

  const content = (
    <>
      <span className="grid size-8 shrink-0 place-items-center rounded-md bg-accent-soft text-xs font-semibold text-accent dark:text-accent-bright">
        {initials(me.organization.name)}
      </span>
      {!collapsed && (
        <span className="min-w-0 flex-1 text-left">
          <span className="block truncate text-sm font-medium">{me.organization.name}</span>
          <span className="block truncate text-xs text-muted">{ROLE_LABELS[me.role]}</span>
        </span>
      )}
      {!collapsed && multiple && <ChevronsUpDown className="size-4 shrink-0 text-muted" />}
    </>
  );
  const boxClass = cn(
    'flex w-full items-center gap-2.5 rounded-lg border border-border bg-surface p-2',
    collapsed && 'justify-center border-transparent p-1',
  );

  if (!multiple) {
    return (
      <div className={boxClass} title={collapsed ? me.organization.name : undefined}>
        {content}
      </div>
    );
  }

  async function select(organizationId: string) {
    if (organizationId === me.organization.id) return;
    setSwitching(true);
    try {
      const next = await switchOrganization(organizationId);
      toast.success(`Agora você está em ${next.organization.name}.`);
      navigate('/');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSwitching(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={cn(boxClass, 'hover:bg-surface-muted')} aria-label="Trocar de oficina">
          {content}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Suas oficinas</DropdownMenuLabel>
        {me.organizations.map((org) => (
          <DropdownMenuItem key={org.id} disabled={switching} onSelect={() => void select(org.id)}>
            <span className="min-w-0 flex-1">
              <span className="block truncate">{org.name}</span>
              <span className="block text-xs text-muted">{ROLE_LABELS[org.role]}</span>
            </span>
            {org.id === me.organization.id && <Check className="!text-accent dark:!text-accent-bright" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function UserMenu() {
  const me = useMe();
  const { signOut } = useSession();
  const navigate = useNavigate();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="rounded-full" aria-label="Menu da conta">
          <Avatar name={me.user.name} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-64">
        <div className="px-2 py-1.5">
          <p className="truncate text-sm font-medium">{me.user.name}</p>
          <p className="truncate text-xs text-muted">{me.user.email}</p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate('/configuracoes/sessoes')}>
          <ShieldCheck />
          Sessões e segurança
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {/* o guard da rota leva para /entrar quando a sessão some */}
        <DropdownMenuItem onSelect={() => void signOut()}>
          <LogOut />
          Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Aviso do período de teste. Só informa: cobrança ainda não existe (V3). */
export function TrialNotice() {
  const { subscription } = useMe();
  if (!subscription || subscription.status !== 'TRIALING' || !subscription.trialEndsAt) return null;
  const days = Math.max(0, Math.ceil((Date.parse(subscription.trialEndsAt) - Date.now()) / 86_400_000));
  return (
    <div className="rounded-lg border border-border bg-surface-muted/60 p-3 text-xs">
      <p className="font-medium">Plano {subscription.planName} em teste</p>
      <p className="mt-0.5 text-muted">
        {days === 0 ? 'Termina hoje' : `${days} ${days === 1 ? 'dia restante' : 'dias restantes'}`}, até{' '}
        {formatDate(subscription.trialEndsAt)}
      </p>
    </div>
  );
}
