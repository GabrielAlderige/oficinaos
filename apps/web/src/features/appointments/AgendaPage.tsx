import {
  addDays,
  APPOINTMENT_STATUS_LABELS,
  dayKey,
  formatMinutes,
  fromDayKey,
  minutesOfDay,
  monthGrid,
  startOfMonth,
  startOfWeek,
  toDayKey,
  wallClock,
  weekdayOf,
  WEEKDAY_LABELS,
  type Appointment,
} from '@oficinaos/shared';
import { CalendarPlus, ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { ApiError } from '../../lib/api-client';
import { Button } from '../../components/ui/button';
import { Alert, Card, PageHeader, Skeleton } from '../../components/ui/display';
import { Select } from '../../components/ui/field';
import { cn } from '../../lib/cn';
import { errorMessage } from '../../lib/errors';
import { useCan, useMe } from '../../lib/session';
import { useMembers, useOrganization } from '../settings/api';
import { useAppointments, useRescheduleAppointment } from './api';
import { AppointmentDialog, type RascunhoAgendamento } from './AppointmentDialog';
import { AppointmentSheet } from './AppointmentSheet';
import { CalendarGrid, colunaDoMecanico, type Coluna } from './CalendarGrid';

type Visao = 'dia' | 'semana' | 'mes';
const VISOES: { valor: Visao; label: string }[] = [
  { valor: 'dia', label: 'Dia' },
  { valor: 'semana', label: 'Semana' },
  { valor: 'mes', label: 'Mês' },
];

const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

const ehVisao = (valor: string | null): valor is Visao => VISOES.some((v) => v.valor === valor);

/** "14/09" a partir da chave do dia, sem passar por `Date` (que traria o fuso do navegador). */
function diaCurto(key: string): string {
  const [, mes, dia] = key.split('-');
  return `${dia}/${mes}`;
}

/**
 * A agenda da oficina. Dia com uma coluna por mecânico, semana com uma coluna
 * por dia e mês em lista — tudo desenhado no relógio da oficina (D28).
 */
export function AgendaPage() {
  const { organization } = useMe();
  const timezone = organization.timezone;
  const podeEditar = useCan('appointments:write');
  const [params, setParams] = useSearchParams();
  const organizacao = useOrganization();
  const equipe = useMembers();
  const remarcar = useRescheduleAppointment();

  const hoje = dayKey(new Date(), timezone);
  const visao = ehVisao(params.get('visao')) ? params.get('visao')! : 'semana';
  const ancora = /^\d{4}-\d{2}-\d{2}$/.test(params.get('dia') ?? '') ? params.get('dia')! : hoje;
  const mecanicoFiltro = params.get('mecanico') ?? '';

  const [aberto, setAberto] = useState<Appointment | null>(null);
  const [rascunho, setRascunho] = useState<RascunhoAgendamento | null>(null);

  const mudar = (chave: string, valor: string | null) => {
    const proximo = new URLSearchParams(params);
    if (valor) proximo.set(chave, valor);
    else proximo.delete(chave);
    setParams(proximo, { replace: true });
  };

  // A janela buscada é sempre a que está na tela, em instantes: o back filtra
  // por sobreposição, então o que começa antes e invade o período aparece.
  const dias = useMemo(() => {
    if (visao === 'dia') return [ancora];
    if (visao === 'semana') return Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(ancora), i));
    return monthGrid(ancora);
  }, [visao, ancora]);

  const primeiro = dias[0]!;
  const ultimo = dias.at(-1)!;
  const janela = {
    from: fromDayKey(primeiro, 0, timezone).toISOString(),
    to: fromDayKey(addDays(ultimo, 1), 0, timezone).toISOString(),
    mechanicId: mecanicoFiltro || undefined,
  };
  const agenda = useAppointments(janela);

  const membros = (equipe.data ?? []).filter((membro) => membro.isActive);
  const colunas: Coluna[] = useMemo(() => {
    if (visao === 'semana') {
      return dias.map((dia) => ({
        key: dia,
        label: WEEKDAY_LABELS[weekdayOf(dia)],
        sublabel: diaCurto(dia),
        dayKey: dia,
      }));
    }
    const doDia = membros
      .filter((membro) => !mecanicoFiltro || membro.userId === mecanicoFiltro)
      .map((membro) => ({
        key: colunaDoMecanico(membro.userId),
        label: membro.name,
        color: membro.calendarColor,
        dayKey: ancora,
        mechanicUserId: membro.userId as string | null,
      }));
    return [...doDia, { key: colunaDoMecanico(null), label: 'Sem mecânico', dayKey: ancora, mechanicUserId: null }];
  }, [visao, dias, membros, mecanicoFiltro, ancora]);

  function andar(passo: number) {
    if (visao === 'dia') mudar('dia', addDays(ancora, passo));
    else if (visao === 'semana') mudar('dia', addDays(ancora, passo * 7));
    else {
      const { year, month } = wallClock(fromDayKey(startOfMonth(ancora), 12 * 60, timezone), timezone);
      const alvo = new Date(Date.UTC(year, month - 1 + passo, 1));
      mudar('dia', toDayKey({ year: alvo.getUTCFullYear(), month: alvo.getUTCMonth() + 1, day: 1 }));
    }
  }

  const titulo = (() => {
    const { year, month } = wallClock(fromDayKey(ancora, 12 * 60, timezone), timezone);
    if (visao === 'dia') return `${diaCurto(ancora)} de ${MESES[month - 1]}`;
    if (visao === 'mes') return `${MESES[month - 1]} de ${year}`;
    return `${diaCurto(primeiro)} a ${diaCurto(ultimo)}`;
  })();

  /** Arrastar e soltar: se der conflito, a confirmação vem no diálogo. */
  async function mover(input: { appointment: Appointment; startsAt: string; endsAt: string; mechanicUserId: string | null }) {
    try {
      await remarcar.mutateAsync({
        id: input.appointment.id,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        mechanicUserId: input.mechanicUserId,
      });
      toast.success('Agendamento remarcado.');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'APPOINTMENT_CONFLICT') {
        // o diálogo repete o pedido com "confirmar mesmo assim"
        setRascunho({
          appointment: input.appointment,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          mechanicUserId: input.mechanicUserId,
        });
        return;
      }
      toast.error(errorMessage(err));
    }
  }

  const carregando = agenda.isPending || organizacao.isPending;

  return (
    <>
      <PageHeader
        title="Agenda"
        description="Dia, semana e mês. Arraste um compromisso para remarcar."
        actions={
          podeEditar && (
            <Button onClick={() => setRascunho({ startsAt: null })}>
              <CalendarPlus className="size-4" aria-hidden="true" />
              Agendar
            </Button>
          )
        }
      />

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" aria-label="Período anterior" onClick={() => andar(-1)}>
              <ChevronLeft className="size-4" />
            </Button>
            <Button variant="ghost" size="icon" aria-label="Próximo período" onClick={() => andar(1)}>
              <ChevronRight className="size-4" />
            </Button>
            <Button variant="secondary" size="sm" onClick={() => mudar('dia', hoje)}>
              Hoje
            </Button>
          </div>
          <p className="min-w-40 text-sm font-medium first-letter:uppercase">{titulo}</p>

          <div className="ms-auto flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="filtro-mecanico">
              Mecânico
            </label>
            <Select
              id="filtro-mecanico"
              className="w-44"
              value={mecanicoFiltro}
              onChange={(event) => mudar('mecanico', event.target.value)}
            >
              <option value="">Toda a equipe</option>
              {membros.map((membro) => (
                <option key={membro.userId} value={membro.userId}>
                  {membro.name}
                </option>
              ))}
            </Select>
            <div className="flex rounded-md border border-border p-0.5" role="group" aria-label="Visão da agenda">
              {VISOES.map((opcao) => (
                <button
                  key={opcao.valor}
                  type="button"
                  aria-pressed={visao === opcao.valor}
                  onClick={() => mudar('visao', opcao.valor)}
                  className={cn(
                    'rounded px-3 py-1 text-sm',
                    visao === opcao.valor ? 'bg-surface-muted font-medium' : 'text-muted hover:text-fg',
                  )}
                >
                  {opcao.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {carregando ? (
          <div className="space-y-3 p-5">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : agenda.isError ? (
          <Alert variant="danger">Não deu para carregar a agenda. Atualize a página.</Alert>
        ) : visao === 'mes' ? (
          <VisaoMes
            dias={dias}
            ancora={ancora}
            appointments={agenda.data ?? []}
            timezone={timezone}
            onPick={setAberto}
          />
        ) : (
          <CalendarGrid
            colunas={colunas}
            appointments={agenda.data ?? []}
            timezone={timezone}
            businessHours={organizacao.data?.businessHours ?? {}}
            agora={new Date()}
            podeEditar={podeEditar}
            onPick={setAberto}
            onNew={({ dayKey: dia, minutes, mechanicUserId }) =>
              setRascunho({
                startsAt: fromDayKey(dia, minutes, timezone).toISOString(),
                mechanicUserId,
              })
            }
            onMove={(input) => void mover(input)}
          />
        )}
      </Card>

      <AppointmentSheet
        appointment={aberto}
        onOpenChange={(open) => !open && setAberto(null)}
        onReschedule={(appointment) => {
          setAberto(null);
          setRascunho({ appointment });
        }}
      />
      <AppointmentDialog rascunho={rascunho} onClose={() => setRascunho(null)} timezone={timezone} />
    </>
  );
}

/**
 * O mês é lista, não grade de horas: em 30 dias o que a oficina quer saber é
 * onde tem gente marcada, não em que minuto. Clicar no dia abre a visão de dia.
 */
function VisaoMes({
  dias,
  ancora,
  appointments,
  timezone,
  onPick,
}: {
  dias: string[];
  ancora: string;
  appointments: Appointment[];
  timezone: string;
  onPick: (appointment: Appointment) => void;
}) {
  const mesAtual = ancora.slice(0, 7);
  const hoje = dayKey(new Date(), timezone);
  const porDia = new Map<string, Appointment[]>();
  for (const item of appointments) {
    const chave = dayKey(new Date(item.startsAt), timezone);
    porDia.set(chave, [...(porDia.get(chave) ?? []), item]);
  }

  return (
    <div>
      <div className="grid grid-cols-7 border-b border-border">
        {dias.slice(0, 7).map((dia) => (
          <p key={dia} className="min-w-0 border-l border-border px-2 py-1.5 text-center text-xs font-medium first:border-l-0">
            {WEEKDAY_LABELS[weekdayOf(dia)]}
          </p>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {dias.map((dia) => {
          const doDia = porDia.get(dia) ?? [];
          return (
            <div
              key={dia}
              className={cn(
                'min-h-24 min-w-0 border-t border-l border-border p-1.5 [&:nth-child(7n+1)]:border-l-0',
                dia.slice(0, 7) !== mesAtual && 'bg-surface-muted/40',
              )}
            >
              <p className={cn('mb-1 text-xs tabular-nums', dia === hoje && 'font-semibold text-accent')}>
                {Number(dia.slice(-2))}
              </p>
              <ul className="space-y-1">
                {doDia.slice(0, 4).map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => onPick(item)}
                      className="block w-full truncate rounded px-1 py-0.5 text-left text-xs hover:bg-surface-muted"
                      style={{ borderLeft: `3px solid ${item.mechanicColor ?? 'var(--color-border)'}` }}
                      title={`${item.title} — ${APPOINTMENT_STATUS_LABELS[item.status]}`}
                    >
                      <span className="tabular-nums text-muted">
                        {formatMinutes(minutesOfDay(new Date(item.startsAt), timezone))}
                      </span>{' '}
                      {item.title}
                    </button>
                  </li>
                ))}
                {doDia.length > 4 && <li className="px-1 text-xs text-muted">+{doDia.length - 4}</li>}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
