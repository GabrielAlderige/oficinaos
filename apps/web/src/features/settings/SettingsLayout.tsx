import { NavLink, Outlet } from 'react-router';
import { PageHeader } from '../../components/ui/display';
import { cn } from '../../lib/cn';

const TABS = [
  { to: 'oficina', label: 'Oficina' },
  { to: 'precos', label: 'Preços e estoque' },
  { to: 'fiscal', label: 'Fiscal' },
  { to: 'equipe', label: 'Equipe' },
  { to: 'plano', label: 'Plano' },
  { to: 'importar', label: 'Importar' },
  { to: 'sessoes', label: 'Sessões' },
];

export function SettingsLayout() {
  return (
    <>
      <PageHeader title="Configurações" description="Dados da oficina, preços, equipe e segurança da sua conta." />
      <nav aria-label="Seções das configurações" className="mb-6 flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) =>
              cn(
                '-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors',
                isActive
                  ? 'border-accent text-foreground dark:border-accent-bright'
                  : 'border-transparent text-muted hover:text-foreground',
              )
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </>
  );
}
