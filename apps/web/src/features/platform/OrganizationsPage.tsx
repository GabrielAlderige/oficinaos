import type { PlatformOrganization } from '@oficinaos/shared';
import { CalendarPlus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Alert, Badge, Card, CardHeader, PageHeader, Skeleton } from '../../components/ui/display';
import { Field, fieldA11y } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '../../components/ui/overlays';
import { errorMessage } from '../../lib/errors';
import { formatDate } from '../../lib/format';
import { useExtendTrial, usePlatformOrganizations } from './api';

/**
 * As oficinas do SaaS, para a PLATAFORMA operar (E41).
 *
 * Antes desta tela, estender o teste de uma oficina exigia abrir o Postgres de
 * produção e escrever SQL na mão — sem registro de quem fez nem por quê. Para
 * um piloto com preço de fundador, que precisa de 60 ou 90 dias em vez de 14,
 * isso era a única saída.
 */
export function OrganizationsPage() {
  const visao = usePlatformOrganizations();
  const [estendendo, setEstendendo] = useState<PlatformOrganization | null>(null);

  return (
    <>
      <PageHeader
        title="Oficinas"
        description="Todas as oficinas do sistema, com a situação da assinatura calculada do mesmo jeito que a oficina vê."
      />

      {visao.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : visao.isError ? (
        <Alert variant="danger">{errorMessage(visao.error)}</Alert>
      ) : (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-4">
            <Resumo titulo="Oficinas" valor={visao.data.total} />
            <Resumo titulo="Em teste" valor={visao.data.emTeste} />
            <Resumo titulo="Assinantes" valor={visao.data.assinantes} />
            <Resumo titulo="Bloqueadas" valor={visao.data.bloqueadas} destaque={visao.data.bloqueadas > 0} />
          </div>

          <Card>
            <CardHeader title="Lista" description="Mais recentes primeiro." />
            {visao.data.organizations.length === 0 ? (
              <p className="px-5 pb-5 text-sm text-muted">Nenhuma oficina cadastrada ainda.</p>
            ) : (
              <ul className="divide-y divide-border">
                {visao.data.organizations.map((oficina) => (
                  <li key={oficina.id}>
                    <Linha oficina={oficina} onEstender={() => setEstendendo(oficina)} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      <EstenderDialog oficina={estendendo} onFechar={() => setEstendendo(null)} />
    </>
  );
}

function Resumo({ titulo, valor, destaque }: { titulo: string; valor: number; destaque?: boolean }) {
  return (
    <Card className="p-4">
      <p className="text-xs tracking-wide text-muted uppercase">{titulo}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${destaque ? 'text-danger' : ''}`}>{valor}</p>
    </Card>
  );
}

function Linha({ oficina, onEstender }: { oficina: PlatformOrganization; onEstender(): void }) {
  /** Um selo só, o mais urgente: dois selos competindo escondem o que importa. */
  const selo = oficina.bloqueada
    ? { tone: 'danger' as const, texto: 'Bloqueada' }
    : oficina.emCarencia
      ? { tone: 'warning' as const, texto: `Carência · ${oficina.diasRestantes} d` }
      : oficina.emTeste
        ? { tone: 'info' as const, texto: `Teste · ${oficina.diasRestantes} d` }
        : { tone: 'success' as const, texto: 'Em dia' };

  return (
    <div className="flex flex-wrap items-center gap-3 px-5 py-3">
      <div className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium">{oficina.name}</span>
          <Badge tone={selo.tone}>{selo.texto}</Badge>
          <Badge tone="neutral">{oficina.planName}</Badge>
          {oficina.subscribed && <Badge tone="success">Assinou</Badge>}
        </span>
        <span className="block truncate text-xs text-muted">
          {oficina.activeUsers} {oficina.activeUsers === 1 ? 'pessoa' : 'pessoas'}
          {oficina.whatsapp ? ` · ${oficina.whatsapp}` : ''}
          {` · entrou em ${formatDate(oficina.createdAt)}`}
        </span>
      </div>
      {oficina.status === 'TRIALING' && (
        <Button variant="secondary" size="sm" onClick={onEstender}>
          <CalendarPlus />
          Estender teste
        </Button>
      )}
    </div>
  );
}

function EstenderDialog({ oficina, onFechar }: { oficina: PlatformOrganization | null; onFechar(): void }) {
  const estender = useExtendTrial();
  const [dias, setDias] = useState('60');
  const [motivo, setMotivo] = useState('');

  return (
    <Dialog
      open={oficina !== null}
      onOpenChange={(aberto) => {
        if (!aberto) {
          setDias('60');
          setMotivo('');
          onFechar();
        }
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader
          title={`Estender o teste de ${oficina?.name ?? ''}`}
          description="Os dias contam a partir de hoje, não do fim anterior — o caso normal é o teste já ter vencido."
        />
        <div className="grid gap-4">
          <Field label="Dias" htmlFor="estender-dias" hint="De 1 a 180.">
            <Input
              {...fieldA11y('estender-dias', undefined, true)}
              inputMode="numeric"
              value={dias}
              onChange={(evento) => setDias(evento.target.value)}
            />
          </Field>
          <Field
            label="Motivo"
            htmlFor="estender-motivo"
            hint="Fica na trilha da oficina. Daqui a seis meses, é isto que explica a exceção."
          >
            <Input
              {...fieldA11y('estender-motivo', undefined, true)}
              value={motivo}
              onChange={(evento) => setMotivo(evento.target.value)}
              placeholder="Ex.: piloto com preço de fundador"
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onFechar}>
            Cancelar
          </Button>
          <Button
            loading={estender.isPending}
            onClick={async () => {
              if (!oficina) return;
              const quantos = Number(dias.replace(/\D/g, ''));
              if (!quantos || quantos < 1 || quantos > 180) {
                toast.error('Informe de 1 a 180 dias.');
                return;
              }
              if (motivo.trim().length < 3) {
                toast.error('Escreva o motivo: ele fica registrado.');
                return;
              }
              try {
                await estender.mutateAsync({ id: oficina.id, days: quantos, reason: motivo.trim() });
                toast.success(`Teste de ${oficina.name} estendido por ${quantos} dias.`);
                onFechar();
              } catch (erro) {
                toast.error(errorMessage(erro));
              }
            }}
          >
            Estender
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
