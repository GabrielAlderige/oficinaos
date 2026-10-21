import { TRIAL_DAYS } from '@oficinaos/shared';
import { ArrowRight, Check, Database, MessageCircle, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Card, CardHeader } from '../../components/ui/display';
import { ConfirmDialog } from '../../components/ui/overlays';
import { cn } from '../../lib/cn';
import { errorMessage } from '../../lib/errors';
import { linkDaImplantacao } from '../../lib/implantacao';
import { useCan, useMe } from '../../lib/session';
import { useServices } from '../catalog/api';
import { useCustomers } from '../customers/api';
import { useQuotes } from '../quotes/api';
import { useOrganization } from '../settings/api';
import { useClearSampleData, useLoadSampleData, useSampleData } from './api';

interface Step {
  title: string;
  description: string;
  done: boolean;
  to?: string;
  action?: string;
}

/**
 * Primeiros passos (oferta Oficina Pronta, D92): os 4 que levam ao momento que
 * vende o sistema — o cliente aprovando o orçamento pelo celular.
 *
 * **Some no primeiro orçamento enviado**, mesmo com algum passo para trás: é
 * ali que o teste de 30 dias começa e a oficina já entendeu para que serve.
 * Lista cumprida que fica na tela vira ruído no painel de quem usa todo dia.
 *
 * Fica no TOPO do Início: para quem acabou de entrar, o painel ainda não tem
 * número nenhum, e a lista no fim da rolagem não era vista.
 */
export function SetupChecklist() {
  const me = useMe();
  const canManageOrg = useCan('organization:manage');
  const canWriteCustomers = useCan('customers:write');
  const canWriteCatalog = useCan('catalog:write');
  const canSendQuote = useCan('quotes:send');
  const organization = useOrganization();
  const customers = useCustomers({ q: '', page: 1, pageSize: 1 }, { enabled: canWriteCustomers });
  const services = useServices({ q: '', status: 'all', page: 1, pageSize: 1 }, { enabled: canWriteCatalog });
  const quotes = useQuotes({ status: 'all', page: 1, pageSize: 1 }, { enabled: canSendQuote });
  const exemplo = useSampleData(canManageOrg);

  const org = organization.data;
  // o que veio do exemplo não conta como passo cumprido: cliente de mentira não é cliente
  const doExemplo = exemplo.data?.loaded ? exemplo.data : null;
  const steps: Step[] = [];
  if (canManageOrg) {
    steps.push({
      title: 'Complete os dados da oficina',
      description: 'Logo, CNPJ e endereço aparecem no orçamento que o cliente recebe e na OS impressa.',
      done: Boolean(org?.document && org.address.city),
      to: '/configuracoes/oficina',
      action: 'Completar dados',
    });
  }
  if (canWriteCustomers) {
    steps.push({
      title: 'Cadastre um cliente e o carro dele',
      description: 'Um carro que está no pátio hoje. Depois é só digitar a placa em qualquer tela, com Ctrl+K.',
      done: (customers.data?.meta.total ?? 0) > (doExemplo?.customers ?? 0),
      to: '/clientes',
      action: 'Cadastrar cliente',
    });
  }
  if (canWriteCatalog) {
    steps.push({
      title: 'Cadastre um serviço com preço',
      description: 'Com preço e tempo padrão, o orçamento sai em poucos cliques.',
      done: (services.data?.meta.total ?? 0) > (doExemplo?.services ?? 0),
      to: '/servicos',
      action: 'Cadastrar serviço',
    });
  }
  if (canSendQuote) {
    steps.push({
      title: 'Envie o primeiro orçamento',
      description: `Abra uma OS, mande o orçamento pelo WhatsApp e veja o cliente aprovar pelo celular. É aqui que os ${TRIAL_DAYS} dias de teste começam.`,
      done: (quotes.data?.meta.total ?? 0) > 0,
      to: '/ordens',
      action: 'Abrir uma OS',
    });
  }

  // enquanto qualquer contagem não chegou, o passo apareceria como PENDENTE e
  // piscaria "cadastre o primeiro cliente" numa oficina cheia de clientes
  const carregando = [organization, customers, services, quotes].some(
    (consulta) => consulta.isPending && consulta.fetchStatus !== 'idle',
  );
  const feitos = steps.filter((step) => step.done).length;
  const jaOrcou = (quotes.data?.meta.total ?? 0) > 0;
  if (steps.length === 0 || carregando || jaOrcou || feitos === steps.length) return null;

  return (
    <Card>
      <CardHeader
        title="Primeiros passos"
        description={`${feitos} de ${steps.length} concluídos`}
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
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border px-5 py-3 text-sm text-muted">
        <span className="min-w-0 flex-1 basis-60">Prefere que a gente configure? A implantação é grátis.</span>
        <a
          className="inline-flex items-center gap-1.5 font-medium text-accent underline-offset-4 hover:underline dark:text-accent-bright"
          href={linkDaImplantacao(me.organization.name)}
          target="_blank"
          rel="noreferrer"
        >
          <MessageCircle className="size-4" aria-hidden="true" />
          Pedir pelo WhatsApp
        </a>
      </div>
    </Card>
  );
}

/**
 * O exemplo carregado (ou a oferta de carregar). Fica FORA da lista de
 * primeiros passos de propósito: a lista some no primeiro orçamento, e o
 * botão de apagar o exemplo não pode sumir junto.
 */
export function SampleDataNotice() {
  const canManageOrg = useCan('organization:manage');
  const exemplo = useSampleData(canManageOrg);
  const quotes = useQuotes({ status: 'all', page: 1, pageSize: 1 }, { enabled: canManageOrg });
  const carregar = useLoadSampleData();
  const apagar = useClearSampleData();
  const [confirmando, setConfirmando] = useState(false);

  if (!canManageOrg || !exemplo.data) return null;

  if (exemplo.data.loaded) {
    return (
      <>
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-warning/40 bg-warning-soft px-4 py-3 text-sm">
          <Database className="size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 basis-60">
            <strong>Você está vendo dados de exemplo:</strong> {exemplo.data.customers} clientes com carro e{' '}
            {exemplo.data.services} serviços, com "(exemplo)" no nome.
          </span>
          <Button variant="secondary" size="sm" onClick={() => setConfirmando(true)}>
            <Trash2 />
            Apagar exemplo
          </Button>
        </div>
        <ConfirmDialog
          open={confirmando}
          onOpenChange={setConfirmando}
          title="Apagar os dados de exemplo?"
          description="Saem os clientes, carros e serviços de exemplo. O que você cadastrou continua. Cliente de exemplo que já tem OS fica, para a OS não perder o dono."
          confirmLabel="Apagar exemplo"
          destructive
          onConfirm={async () => {
            try {
              const depois = await apagar.mutateAsync();
              toast.success(
                depois.kept > 0
                  ? `Exemplo apagado. ${depois.kept} cliente${depois.kept === 1 ? '' : 's'} com OS ficou.`
                  : 'Exemplo apagado.',
              );
            } catch (erro) {
              toast.error(errorMessage(erro));
            }
          }}
        />
      </>
    );
  }

  // só para quem está começando: depois do primeiro orçamento, exemplo não ajuda mais
  if ((quotes.data?.meta.total ?? 1) > 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-sm">
      <Database className="size-4 shrink-0 text-muted" aria-hidden="true" />
      <span className="min-w-0 flex-1 basis-60 text-muted">
        Quer ver o sistema cheio antes de cadastrar os seus? Carregue clientes, carros e serviços de exemplo.
      </span>
      <Button
        variant="secondary"
        size="sm"
        loading={carregar.isPending}
        onClick={async () => {
          try {
            await carregar.mutateAsync();
            toast.success('Dados de exemplo carregados.');
          } catch (erro) {
            toast.error(errorMessage(erro));
          }
        }}
      >
        Carregar exemplo
      </Button>
    </div>
  );
}
