import { ROLE_LABELS } from '@oficinaos/shared';
import { ArrowRight, Check } from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '../../components/ui/button';
import { Card, CardHeader, PageHeader } from '../../components/ui/display';
import { cn } from '../../lib/cn';
import { firstName } from '../../lib/format';
import { useCan, useMe } from '../../lib/session';
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
 * Início da E2: boas-vindas + primeiros passos que JÁ existem. O dashboard de
 * verdade (faturamento, OS, "atenção necessária") chega na E9, com dados reais.
 */
export function HomePage() {
  const me = useMe();
  const canManageOrg = useCan('organization:manage');
  const canManageTeam = useCan('team:manage');
  const organization = useOrganization();
  const members = useMembers();
  const invitations = useInvitations(canManageTeam);
  const canWriteCustomers = useCan('customers:write');
  const customers = useCustomers({ q: '', page: 1, pageSize: 1 }, { enabled: canWriteCustomers });

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
  if (canManageTeam) {
    steps.push({
      title: 'Convide a sua equipe',
      description: 'Mecânicos e atendentes entram com o próprio acesso, e cada um vê só o que precisa.',
      done: (members.data?.length ?? 0) > 1 || (invitations.data?.length ?? 0) > 0,
      to: '/configuracoes/equipe',
      action: 'Convidar',
    });
  }
  // quem não gerencia oficina nem equipe não tem passos a cumprir: sem checklist de fachada
  if (steps.length === 1) {
    return (
      <>
        <PageHeader title={`Olá, ${firstName(me.user.name)}`} description={`Você está no painel da ${me.organization.name}.`} />
        <Card className="px-5 py-10 text-center">
          <p className="font-medium">Tudo certo com o seu acesso</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">
            Você entrou na equipe como {ROLE_LABELS[me.role]}. As ordens de serviço e a agenda da oficina vão
            aparecer aqui assim que estiverem em uso.
          </p>
        </Card>
      </>
    );
  }

  const doneCount = steps.filter((s) => s.done).length;
  const loading = organization.isPending || members.isPending;

  return (
    <>
      <PageHeader title={`Olá, ${firstName(me.user.name)}`} description={`Você está no painel da ${me.organization.name}.`} />
      <Card>
        <CardHeader
          title="Primeiros passos"
          description={loading ? 'Carregando…' : `${doneCount} de ${steps.length} concluídos`}
          action={
            <div className="h-2 w-32 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
              <div className="h-full rounded-full bg-accent-bright transition-[width]" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
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
    </>
  );
}
