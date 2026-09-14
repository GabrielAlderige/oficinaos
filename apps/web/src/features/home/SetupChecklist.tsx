import { ArrowRight, Check } from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '../../components/ui/button';
import { Card, CardHeader } from '../../components/ui/display';
import { cn } from '../../lib/cn';
import { useCan, useMe } from '../../lib/session';
import { useParts, useServices } from '../catalog/api';
import { useCustomers } from '../customers/api';
import { useInvitations, useMembers, useOrganization } from '../settings/api';

interface Step {
  title: string;
  description: string;
  done: boolean;
  to?: string;
  action?: string;
}

/**
 * Onboarding curto (ajuste do MVP 1): o cadastro pede 5 campos e o resto vira
 * checklist aqui. **Some sozinho quando termina** — lista de tarefas cumprida
 * que fica na tela vira ruído no painel de quem usa todo dia.
 */
export function SetupChecklist() {
  const me = useMe();
  const canManageOrg = useCan('organization:manage');
  const canManageTeam = useCan('team:manage');
  const canWriteCustomers = useCan('customers:write');
  const canWriteCatalog = useCan('catalog:write');
  const organization = useOrganization();
  const members = useMembers();
  const invitations = useInvitations(canManageTeam);
  const customers = useCustomers({ q: '', page: 1, pageSize: 1 }, { enabled: canWriteCustomers });
  const services = useServices({ q: '', status: 'all', page: 1, pageSize: 1 }, { enabled: canWriteCatalog });
  const parts = useParts({ q: '', attention: false, page: 1, pageSize: 1 }, { enabled: canWriteCatalog });

  const org = organization.data;
  const steps: Step[] = [
    { title: 'Conta criada', description: `${me.organization.name} já está no OficinaOS.`, done: true },
  ];
  if (canManageOrg) {
    steps.push({
      title: 'Complete os dados da oficina',
      description: 'CNPJ, endereço e horário de funcionamento vão aparecer nos orçamentos e na OS impressa.',
      done: Boolean(org?.document && org.address.city && Object.keys(org.businessHours).length),
      to: '/configuracoes/oficina',
      action: 'Completar dados',
    });
  }
  if (canWriteCustomers) {
    steps.push({
      title: 'Cadastre o primeiro cliente e o carro dele',
      description: 'Depois é só digitar a placa (antiga ou Mercosul) em qualquer tela, com Ctrl+K.',
      done: (customers.data?.meta.total ?? 0) > 0,
      to: '/clientes',
      action: 'Cadastrar cliente',
    });
  }
  if (canWriteCatalog) {
    const temServicos = (services.data?.meta.total ?? 0) > 0;
    steps.push({
      title: 'Monte o catálogo de serviços e peças',
      description: 'Com preço e tempo padrão cadastrados, o orçamento sai em poucos cliques.',
      done: temServicos && (parts.data?.meta.total ?? 0) > 0,
      to: temServicos ? '/pecas' : '/servicos',
      action: temServicos ? 'Cadastrar peças' : 'Cadastrar serviços',
    });
  }
  if (canManageTeam) {
    steps.push({
      title: 'Convide a sua equipe',
      description: 'Mecânicos e atendentes entram com o próprio acesso, e cada um vê só o que precisa.',
      done: (members.data?.length ?? 0) > 1 || (invitations.data?.length ?? 0) > 0,
      to: '/configuracoes/equipe',
      action: 'Convidar',
    });
  }

  // enquanto qualquer contagem não chegou, o passo apareceria como PENDENTE e
  // piscaria "cadastre o primeiro cliente" numa oficina cheia de clientes
  const carregando = [organization, members, customers, services, parts].some(
    (consulta) => consulta.isPending && consulta.fetchStatus !== 'idle',
  );
  const feitos = steps.filter((step) => step.done).length;
  // quem não gerencia oficina nem equipe não tem passo nenhum: sem checklist de fachada
  if (steps.length === 1 || carregando || feitos === steps.length) return null;

  return (
    <Card>
      <CardHeader
        title="Primeiros passos"
        description={carregando ? 'Carregando…' : `${feitos} de ${steps.length} concluídos`}
        action={
          <div className="h-2 w-32 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
            <div
              className="h-full rounded-full bg-accent-bright transition-[width]"
              style={{ width: `${(feitos / steps.length) * 100}%` }}
            />
          </div>
        }
      />
      <ol className="divide-y divide-border">
        {steps.map((step) => (
          <li key={step.title} className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4">
            <span
              className={cn(
                'grid size-7 shrink-0 place-items-center rounded-full border',
                step.done ? 'border-transparent bg-success text-white dark:text-[#121211]' : 'border-border text-transparent',
              )}
              aria-hidden="true"
            >
              <Check className="size-4" />
            </span>
            <div className="min-w-0 flex-1 basis-60">
              <p className={cn('text-sm font-medium', step.done && 'text-muted line-through decoration-muted/50')}>
                {step.title}
                <span className="sr-only">{step.done ? ' (concluído)' : ' (pendente)'}</span>
              </p>
              <p className="text-sm text-muted">{step.description}</p>
            </div>
            {!step.done && step.to && (
              <Button asChild variant="secondary" size="sm">
                <Link to={step.to}>
                  {step.action}
                  <ArrowRight />
                </Link>
              </Button>
            )}
          </li>
        ))}
      </ol>
    </Card>
  );
}
