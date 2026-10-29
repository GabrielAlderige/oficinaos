import { PATIO_COLUMNS, WORK_ORDER_STATUS_LABELS, type WorkOrderListItem } from '@oficinaos/shared';
import { Clock, PackageSearch, Wrench } from 'lucide-react';
import { Link } from 'react-router';
import { PlateBadge } from '../../components/plate-badge';
import { Alert, Skeleton } from '../../components/ui/display';
import { cn } from '../../lib/cn';
import { errorMessage } from '../../lib/errors';
import { firstName } from '../../lib/format';
import { PATIO_MAX, usePatio } from './api';

const hora = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
const diaMes = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });
const dia = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' });

/** "hoje 17:00", "amanhã 09:00" ou "25/10 17:00": o que a equipe fala em voz alta. */
export function prazoCurto(iso: string, agora = new Date()): string {
  const quando = new Date(iso);
  const hoje = dia.format(agora);
  const amanha = dia.format(new Date(agora.getTime() + 86_400_000));
  const alvo = dia.format(quando);
  const rotulo = alvo === hoje ? 'hoje' : alvo === amanha ? 'amanhã' : diaMes.format(quando);
  return `${rotulo} ${hora.format(quando)}`;
}

/** Dias desde que o carro entrou: "hoje", "1 dia", "4 dias". */
function tempoNaOficina(iso: string, agora = new Date()): string {
  const dias = Math.floor((Date.parse(dia.format(agora)) - Date.parse(dia.format(new Date(iso)))) / 86_400_000);
  return dias <= 0 ? 'entrou hoje' : dias === 1 ? 'há 1 dia' : `há ${dias} dias`;
}

function Cartao({ order, tv, agora }: { order: WorkOrderListItem; tv: boolean; agora: Date }) {
  const atrasado = order.promisedAt !== null && Date.parse(order.promisedAt) < agora.getTime() && order.status !== 'COMPLETED';
  const destaque =
    order.status === 'WAITING_PARTS' ? 'peca' : order.status === 'AWAITING_APPROVAL' ? 'aprovacao' : null;
  const corpo = (
    <>
      <div className="flex items-start justify-between gap-2">
        <PlateBadge plate={order.vehiclePlate} size={tv ? 'lg' : 'sm'} />
        <span className={cn('font-semibold tabular text-muted', tv ? 'text-lg' : 'text-xs')}>#{order.number}</span>
      </div>
      <p className={cn('mt-1.5 truncate font-medium', tv ? 'text-xl' : 'text-sm')}>{order.vehicleName}</p>
      <p className={cn('truncate text-muted', tv ? 'text-base' : 'text-xs')}>{firstName(order.customerName)}</p>
      <div className={cn('mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted', tv ? 'text-base' : 'text-xs')}>
        {order.mechanicName && (
          <span className="inline-flex items-center gap-1">
            <Wrench className={tv ? 'size-4' : 'size-3'} aria-hidden="true" />
            {firstName(order.mechanicName)}
          </span>
        )}
        {order.promisedAt ? (
          <span className={cn('inline-flex items-center gap-1', atrasado && 'font-semibold text-danger')}>
            <Clock className={tv ? 'size-4' : 'size-3'} aria-hidden="true" />
            {atrasado ? 'atrasado · ' : ''}
            {prazoCurto(order.promisedAt, agora)}
          </span>
        ) : (
          <span>{tempoNaOficina(order.openedAt, agora)}</span>
        )}
      </div>
      {destaque && (
        <p
          className={cn(
            'mt-2 inline-flex items-center gap-1 rounded-md bg-warning-soft px-2 py-0.5 font-medium text-warning',
            tv ? 'text-base' : 'text-xs',
          )}
        >
          {destaque === 'peca' && <PackageSearch className={tv ? 'size-4' : 'size-3'} aria-hidden="true" />}
          {WORK_ORDER_STATUS_LABELS[order.status]}
        </p>
      )}
    </>
  );
  const classe = cn(
    'block rounded-lg border bg-surface shadow-xs',
    tv ? 'p-4' : 'p-3',
    atrasado ? 'border-danger/60' : 'border-border',
  );
  // na TV ninguém clica: o cartão não é link (e não ganha o contorno de foco)
  return tv ? (
    <div className={classe}>{corpo}</div>
  ) : (
    <Link to={`/ordens/${order.number}`} className={cn(classe, 'hover:border-accent/60 hover:shadow-sm')}>
      {corpo}
    </Link>
  );
}

/**
 * O pátio em colunas (E49), igual para o painel e para a TV da oficina.
 *
 * Só olha: mudar a situação continua sendo na OS, onde cada passo confere o
 * que precisa (estoque, orçamento, assinatura). Arrastar o cartão de coluna
 * pularia essas conferências.
 */
export function PatioBoard({ tv = false, agora = new Date() }: { tv?: boolean; agora?: Date }) {
  const patio = usePatio({ tv });

  if (patio.isPending) {
    return (
      <div className="grid gap-3 md:grid-cols-5">
        {PATIO_COLUMNS.map((coluna) => (
          <Skeleton key={coluna.key} className="h-48 w-full" />
        ))}
      </div>
    );
  }
  if (patio.isError) return <Alert variant="danger">{errorMessage(patio.error)}</Alert>;

  const ordens = patio.data.data;
  const doStatus = (statuses: readonly string[]) =>
    ordens
      .filter((order) => statuses.includes(order.status))
      // quem chegou primeiro fica em cima
      .sort((a, b) => Date.parse(a.openedAt) - Date.parse(b.openedAt));

  return (
    <div className="space-y-3">
      {patio.data.meta.total > PATIO_MAX && (
        <Alert variant="warning">
          São {patio.data.meta.total} carros na oficina; o pátio mostra os {PATIO_MAX} primeiros. A lista mostra todos.
        </Alert>
      )}
      <div className={cn('grid gap-3', tv ? 'sm:grid-cols-3 lg:grid-cols-5' : 'md:grid-cols-3 xl:grid-cols-5')}>
        {PATIO_COLUMNS.map((coluna) => {
          const carros = doStatus(coluna.statuses);
          return (
            <section
              key={coluna.key}
              aria-label={coluna.label}
              className={cn('min-w-0 rounded-xl bg-surface-muted/70', tv ? 'p-3' : 'p-2.5')}
            >
              <h2 className={cn('mb-2 flex items-start justify-between gap-2 px-1 font-semibold leading-tight', tv ? 'text-xl' : 'text-sm')}>
                <span className="min-w-0">{coluna.label}</span>
                <span
                  className={cn(
                    'rounded-full bg-surface px-2 tabular text-muted',
                    tv ? 'text-lg' : 'text-xs leading-5',
                  )}
                >
                  {carros.length}
                </span>
              </h2>
              {carros.length ? (
                <ul className="space-y-2">
                  {carros.map((order) => (
                    <li key={order.id}>
                      <Cartao order={order} tv={tv} agora={agora} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={cn('px-1 py-4 text-center text-muted', tv ? 'text-base' : 'text-xs')}>Nenhum carro</p>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
