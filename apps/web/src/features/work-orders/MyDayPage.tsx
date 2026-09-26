import type { MyDay, WorkOrderAction } from '@oficinaos/shared';
import { availableActions, WORK_ORDER_STATUS_LABELS, WORK_ORDER_STATUS_TONES } from '@oficinaos/shared';
import { Camera, ChevronRight, Clock, Play, Square, Wrench } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { PlateBadge } from '../../components/plate-badge';
import { Button } from '../../components/ui/button';
import { Alert, Badge, Card, Skeleton } from '../../components/ui/display';
import { EmptyState } from '../../components/ui/list-parts';
import { cn } from '../../lib/cn';
import { errorMessage } from '../../lib/errors';
import { useMe } from '../../lib/session';
import { useMyDay, useRunAction, useStopItemTimer } from './api';

type Ordem = MyDay['orders'][number];

/**
 * "Minhas OS" — a tela de quem trabalha no celular (E24).
 *
 * O mecânico está de pé, ao lado do carro, muitas vezes com a mão suja e com
 * o 3G ruim do fundo da oficina. Então: **uma requisição só**, botão grande,
 * o cronômetro correndo sempre em cima, e nada que exija ler texto pequeno
 * para decidir o que fazer.
 *
 * Ela não é uma versão encolhida da lista de OS: é a lista **dele**, com a
 * próxima ação de cada carro já resolvida pela máquina de estados.
 */
export function MyDayPage() {
  const dia = useMyDay();

  return (
    <>
      <header className="mb-4">
        <h1 className="text-xl font-semibold tracking-tight">Minhas OS</h1>
        <p className="text-sm text-muted">Os carros que estão com você agora.</p>
      </header>

      {dia.isPending ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : dia.isError ? (
        <Alert variant="danger">{errorMessage(dia.error)}</Alert>
      ) : (
        <div className="space-y-3">
          {dia.data.runningTimer && <CronometroCorrendo timer={dia.data.runningTimer} />}

          {!dia.data.orders.length ? (
            <Card>
              <EmptyState
                icon={Wrench}
                title="Nenhum carro com você agora"
                description="Quando alguém colocar o seu nome numa OS, ela aparece aqui. Enquanto isso, dá para ver todas as OS da oficina."
                action={
                  <Button asChild variant="secondary">
                    <Link to="/ordens">Ver todas as OS</Link>
                  </Button>
                }
              />
            </Card>
          ) : (
            <ul className="space-y-3">
              {dia.data.orders.map((ordem) => (
                <li key={ordem.id}>
                  <CartaoDaOS ordem={ordem} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}

/**
 * O cronômetro esquecido correndo é o erro mais caro desta tela: o relatório
 * de produtividade passa a mentir, e o mecânico só descobre no fim do mês.
 * Por isso ele fica no topo, contando, com o botão de parar do lado.
 */
function CronometroCorrendo({ timer }: { timer: NonNullable<MyDay['runningTimer']> }) {
  const [agora, setAgora] = useState(() => Date.now());
  const parar = useStopItemTimer(timer.workOrderId, timer.workOrderNumber);

  useEffect(() => {
    const relogio = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(relogio);
  }, []);

  const segundos = Math.max(0, Math.floor((agora - new Date(timer.startedAt).getTime()) / 1000));
  const relogio = [Math.floor(segundos / 3600), Math.floor((segundos % 3600) / 60), segundos % 60]
    .map((parte) => String(parte).padStart(2, '0'))
    .join(':');

  return (
    <Card className="border-accent-bright bg-accent-soft/60">
      <div className="flex flex-wrap items-center gap-3 p-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-white">
          <Clock className="size-5 motion-safe:animate-pulse" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-2xl font-semibold tabular tracking-tight" aria-live="off">
            {relogio}
          </p>
          <p className="truncate text-sm text-muted">
            OS {timer.workOrderNumber} · {timer.itemDescription}
          </p>
        </div>
        <Button
          size="lg"
          className="h-12 min-w-28"
          loading={parar.isPending}
          onClick={async () => {
            try {
              await parar.mutateAsync(timer.itemId);
              toast.success('Cronômetro parado.');
            } catch (erro) {
              toast.error(errorMessage(erro));
            }
          }}
        >
          <Square />
          Parar
        </Button>
      </div>
    </Card>
  );
}

function CartaoDaOS({ ordem }: { ordem: Ordem }) {
  const me = useMe();
  const acoes = availableActions(ordem.status, (permissao) => me.permissions.includes(permissao));
  const rodar = useRunAction(ordem.id);

  // no celular, uma ação só: a PRÓXIMA do trabalho, na ordem em que o serviço
  // acontece. O resto (aguardando peça, cancelar) fica na ficha da OS, a um
  // toque daqui — botão que oferece cinco caminhos não decide nada
  const principal = PRINCIPAIS.map((acao) => acoes.find((disponivel) => disponivel.action === acao)).find(Boolean);

  return (
    <Card className={cn('overflow-hidden', ordem.hasRunningTimer && 'border-accent-bright')}>
      <Link to={`/ordens/${ordem.number}`} className="block px-4 py-3 hover:bg-surface-muted/60">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">OS {ordem.number}</span>
              <Badge tone={WORK_ORDER_STATUS_TONES[ordem.status]}>{WORK_ORDER_STATUS_LABELS[ordem.status]}</Badge>
            </p>
            <p className="mt-0.5 truncate text-sm">{ordem.vehicleName}</p>
            <p className="truncate text-sm text-muted">{ordem.customerName}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            {ordem.vehiclePlate && <PlateBadge plate={ordem.vehiclePlate} />}
            <ChevronRight className="size-4 text-muted" aria-hidden="true" />
          </div>
        </div>
        {ordem.complaint && <p className="mt-2 line-clamp-2 text-sm text-muted">“{ordem.complaint}”</p>}
      </Link>

      <div className="flex gap-2 border-t border-border p-3">
        {principal && (
          <Button
            className="h-11 flex-1"
            loading={rodar.isPending}
            onClick={async () => {
              try {
                const atualizada = await rodar.mutateAsync({ action: principal.action });
                toast.success(`OS ${atualizada.number}: ${WORK_ORDER_STATUS_LABELS[atualizada.status].toLowerCase()}.`);
              } catch (erro) {
                toast.error(errorMessage(erro));
              }
            }}
          >
            {principal.action === 'start' ? <Play /> : <Wrench />}
            {principal.label}
          </Button>
        )}
        <Button asChild variant="secondary" className={cn('h-11', principal ? 'px-4' : 'flex-1')}>
          <Link to={`/ordens/${ordem.number}#check-in`}>
            <Camera />
            {principal ? <span className="sr-only">Fotos e check-in</span> : 'Fotos e check-in'}
          </Link>
        </Button>
      </div>
    </Card>
  );
}

/**
 * A próxima ação do carro, na ordem em que o serviço acontece — é essa ordem
 * que decide qual botão aparece. Entregar e cancelar ficam de fora de
 * propósito: são decisões de balcão, e o mecânico nem tem permissão. "Aguardando
 * peça" também sai daqui: é exceção, e exceção mora na ficha da OS.
 */
const PRINCIPAIS: WorkOrderAction[] = ['start-diagnosis', 'finish-diagnosis', 'start', 'complete'];
