import {
  APPOINTMENT_STATUS_LABELS,
  businessIntervals,
  dayKey,
  dayPosition,
  formatMinutes,
  fromDayKey,
  gridBounds,
  minutesOfDay,
  weekdayOf,
  type Appointment,
  type BusinessHours,
} from '@oficinaos/shared';
import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { cn } from '../../lib/cn';

const ALTURA_HORA = 56;
/** Arrastar cai de 15 em 15 minutos: é como a oficina fala ("nove e meia"). */
const PASSO_MIN = 15;
const SEM_MECANICO = 'sem-mecanico';

export interface Coluna {
  key: string;
  label: string;
  sublabel?: string;
  color?: string | null;
  /** dia que esta coluna mostra */
  dayKey: string;
  /** `undefined` = a coluna aceita qualquer mecânico (visão de semana) */
  mechanicUserId?: string | null;
}

interface Arrasto {
  id: string;
  deltaMin: number;
  coluna: Coluna;
}

/**
 * Blocos que se cruzam dividem a largura, como numa agenda de papel. A divisão
 * é por AGRUPAMENTO: dois encaixes de manhã não espremem a tarde inteira.
 */
type Posicionado = { appointment: Appointment; startMinutes: number; endMinutes: number };

function comFaixas(lista: Posicionado[]): (Posicionado & { faixa: number; total: number })[] {
  const ordenada = [...lista].sort((a, b) => a.startMinutes - b.startMinutes || a.endMinutes - b.endMinutes);
  const saida: (Posicionado & { faixa: number; total: number })[] = [];
  let grupo: (Posicionado & { faixa: number })[] = [];
  let fins: number[] = [];
  let fimDoGrupo = -Infinity;

  const fechar = () => {
    const total = Math.max(...grupo.map((item) => item.faixa)) + 1;
    for (const item of grupo) saida.push({ ...item, total });
    grupo = [];
    fins = [];
  };

  for (const item of ordenada) {
    if (grupo.length && item.startMinutes >= fimDoGrupo) fechar();
    let faixa = fins.findIndex((fim) => fim <= item.startMinutes);
    if (faixa === -1) faixa = fins.length;
    fins[faixa] = item.endMinutes;
    fimDoGrupo = Math.max(fimDoGrupo, item.endMinutes);
    grupo.push({ ...item, faixa });
  }
  if (grupo.length) fechar();
  return saida;
}

export function colunaDoMecanico(userId: string | null): string {
  return userId ?? SEM_MECANICO;
}

export interface CalendarGridProps {
  colunas: Coluna[];
  appointments: Appointment[];
  timezone: string;
  businessHours: BusinessHours;
  /** agora, para a linha do "estamos aqui" */
  agora: Date;
  podeEditar: boolean;
  onPick: (appointment: Appointment) => void;
  onNew: (input: { dayKey: string; minutes: number; mechanicUserId: string | null }) => void;
  onMove: (input: {
    appointment: Appointment;
    startsAt: string;
    endsAt: string;
    mechanicUserId: string | null;
  }) => void;
}

/**
 * A grade da agenda (D28). Componente próprio, sem biblioteca de calendário: o
 * bloco é posicionado pelos MINUTOS no relógio da oficina, calculados em
 * `shared/calendar.ts`. Uma biblioteca desenharia no fuso do navegador, e a
 * oficina de Manaus veria tudo uma hora fora do lugar.
 */
export function CalendarGrid({
  colunas,
  appointments,
  timezone,
  businessHours,
  agora,
  podeEditar,
  onPick,
  onNew,
  onMove,
}: CalendarGridProps) {
  const { startMinutes, endMinutes } = gridBounds(businessHours);
  const total = endMinutes - startMinutes;
  const horas = Array.from({ length: Math.ceil(total / 60) + 1 }, (_, i) => startMinutes + i * 60);
  const [arrasto, setArrasto] = useState<Arrasto | null>(null);
  const corpo = useRef<HTMLDivElement>(null);
  // soltar o bloco dispara `click` logo depois do `pointerup`: sem esta trava,
  // toda remarcação por arrasto abria a ficha do compromisso por cima
  const arrastou = useRef(false);

  const topo = (minutos: number) => ((minutos - startMinutes) / total) * 100;
  const altura = (de: number, ate: number) => ((ate - de) / total) * 100;

  /** Minuto sob o ponteiro, já encaixado no passo de 15. */
  function minutoEm(clientY: number, alvo: HTMLElement): number {
    const caixa = alvo.getBoundingClientRect();
    const bruto = startMinutes + ((clientY - caixa.top) / caixa.height) * total;
    return Math.max(startMinutes, Math.min(endMinutes, Math.round(bruto / PASSO_MIN) * PASSO_MIN));
  }

  function colunaEm(clientX: number, clientY: number): Coluna | null {
    const alvo = document.elementFromPoint(clientX, clientY)?.closest('[data-coluna]');
    const chave = alvo?.getAttribute('data-coluna');
    return colunas.find((coluna) => coluna.key === chave) ?? null;
  }

  function comecarArrasto(event: ReactPointerEvent<HTMLElement>, appointment: Appointment, origem: Coluna) {
    if (!podeEditar || event.button !== 0) return;
    const alvoColuna = event.currentTarget.closest('[data-coluna]') as HTMLElement | null;
    if (!alvoColuna) return;
    const inicial = minutoEm(event.clientY, alvoColuna);
    const pego = minutesOfDay(new Date(appointment.startsAt), timezone);
    arrastou.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);

    const mover = (e: PointerEvent) => {
      const coluna = colunaEm(e.clientX, e.clientY) ?? origem;
      const alvo = corpo.current?.querySelector(`[data-coluna="${coluna.key}"]`) as HTMLElement | null;
      const minuto = minutoEm(e.clientY, alvo ?? alvoColuna);
      setArrasto({ id: appointment.id, deltaMin: minuto - inicial, coluna });
    };
    const soltar = (e: PointerEvent) => {
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', soltar);
      const coluna = colunaEm(e.clientX, e.clientY) ?? origem;
      const alvo = corpo.current?.querySelector(`[data-coluna="${coluna.key}"]`) as HTMLElement | null;
      const delta = minutoEm(e.clientY, alvo ?? alvoColuna) - inicial;
      setArrasto(null);
      const mesmoLugar = delta === 0 && coluna.dayKey === origem.dayKey && coluna.key === origem.key;
      if (mesmoLugar) return;
      arrastou.current = true;

      const duracao = (Date.parse(appointment.endsAt) - Date.parse(appointment.startsAt)) / 60_000;
      const novoInicio = fromDayKey(coluna.dayKey, pego + delta, timezone);
      onMove({
        appointment,
        startsAt: novoInicio.toISOString(),
        endsAt: new Date(novoInicio.getTime() + duracao * 60_000).toISOString(),
        mechanicUserId:
          coluna.mechanicUserId === undefined ? appointment.mechanicUserId : coluna.mechanicUserId,
      });
    };
    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
  }

  // oficina que ainda não configurou o expediente não tem "fora do expediente":
  // sombrear a grade inteira diria que está sempre fechada, o que é falso
  const temExpediente = Object.values(businessHours).some((faixas) => faixas?.length);

  /** Faixas fechadas do dia: o inverso do expediente, para sombrear. */
  function fechado(dayKey: string): { de: number; ate: number }[] {
    if (!temExpediente) return [];
    const abertos = businessIntervals(businessHours, weekdayOf(dayKey))
      .map((faixa) => ({ de: Math.max(faixa.startMinutes, startMinutes), ate: Math.min(faixa.endMinutes, endMinutes) }))
      .filter((faixa) => faixa.ate > faixa.de)
      .sort((a, b) => a.de - b.de);
    if (!abertos.length) return [{ de: startMinutes, ate: endMinutes }];
    const buracos: { de: number; ate: number }[] = [];
    let cursor = startMinutes;
    for (const aberto of abertos) {
      if (aberto.de > cursor) buracos.push({ de: cursor, ate: aberto.de });
      cursor = Math.max(cursor, aberto.ate);
    }
    if (cursor < endMinutes) buracos.push({ de: cursor, ate: endMinutes });
    return buracos;
  }

  const alturaPx = (total / 60) * ALTURA_HORA;
  const larguraMinima = colunas.length > 4 ? '6rem' : '9rem';
  const grade = { gridTemplateColumns: `3.5rem repeat(${colunas.length}, minmax(${larguraMinima}, 1fr))` };

  return (
    <div className="overflow-x-auto">
      <div className="min-w-max pb-3">
        <div className="grid border-b border-border bg-surface" style={grade}>
          <div />
          {colunas.map((coluna) => (
            <div key={coluna.key} className="border-l border-border px-2 py-2 text-center">
              <p className="truncate text-sm font-medium">
                {coluna.color && (
                  <span
                    className="mr-1.5 inline-block size-2 rounded-full align-middle"
                    style={{ backgroundColor: coluna.color }}
                    aria-hidden="true"
                  />
                )}
                {coluna.label}
              </p>
              {coluna.sublabel && <p className="text-xs text-muted">{coluna.sublabel}</p>}
            </div>
          ))}
        </div>

        <div ref={corpo} className="grid" style={grade}>
          <div className="relative" style={{ height: alturaPx }}>
            {horas.map((hora) => (
              <span
                key={hora}
                className="absolute right-2 -translate-y-1/2 text-xs text-muted tabular-nums"
                style={{ top: `${topo(hora)}%` }}
              >
                {formatMinutes(hora)}
              </span>
            ))}
          </div>

          {colunas.map((coluna) => {
            const doDia = appointments
              .filter(
                (item) =>
                  coluna.mechanicUserId === undefined || item.mechanicUserId === coluna.mechanicUserId,
              )
              .flatMap((appointment) => {
                const posicao = dayPosition(
                  { startsAt: new Date(appointment.startsAt), endsAt: new Date(appointment.endsAt) },
                  coluna.dayKey,
                  timezone,
                );
                return posicao ? [{ appointment, ...posicao }] : [];
              });
            // o "hoje" é o da oficina: `toISOString()` aqui marcaria o dia errado à noite
            const mostraAgora = coluna.dayKey === dayKey(agora, timezone);

            return (
              <div
                key={coluna.key}
                data-coluna={coluna.key}
                className="relative border-l border-border"
                style={{ height: alturaPx }}
                onClick={(event) => {
                  if (!podeEditar || event.target !== event.currentTarget) return;
                  onNew({
                    dayKey: coluna.dayKey,
                    minutes: minutoEm(event.clientY, event.currentTarget),
                    mechanicUserId: coluna.mechanicUserId ?? null,
                  });
                }}
              >
                {fechado(coluna.dayKey).map((faixa) => (
                  <div
                    key={`${faixa.de}-${faixa.ate}`}
                    className="pointer-events-none absolute inset-x-0 bg-surface-muted/60"
                    style={{ top: `${topo(faixa.de)}%`, height: `${altura(faixa.de, faixa.ate)}%` }}
                  />
                ))}
                {horas.slice(1, -1).map((hora) => (
                  <div
                    key={hora}
                    className="pointer-events-none absolute inset-x-0 border-t border-border/60"
                    style={{ top: `${topo(hora)}%` }}
                  />
                ))}
                {mostraAgora && (
                  <div
                    className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-danger"
                    style={{ top: `${topo(minutesOfDay(agora, timezone))}%` }}
                    aria-hidden="true"
                  />
                )}
                {comFaixas(doDia).map(({ appointment, startMinutes: de, endMinutes: ate, faixa, total: faixas }) => (
                  <Bloco
                    key={appointment.id}
                    appointment={appointment}
                    topo={topo(arrasto?.id === appointment.id ? de + arrasto.deltaMin : de)}
                    altura={altura(de, ate)}
                    faixa={faixa}
                    faixas={faixas}
                    arrastando={arrasto?.id === appointment.id}
                    podeEditar={podeEditar}
                    onPick={() => {
                      if (arrastou.current) {
                        arrastou.current = false;
                        return;
                      }
                      onPick(appointment);
                    }}
                    onPointerDown={(event) => comecarArrasto(event, appointment, coluna)}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const TOM_DA_SITUACAO: Record<Appointment['status'], string> = {
  SCHEDULED: 'bg-surface',
  CONFIRMED: 'bg-info-soft',
  IN_PROGRESS: 'bg-accent-soft',
  COMPLETED: 'bg-success-soft',
  CANCELED: 'bg-surface-muted line-through opacity-60',
  NO_SHOW: 'bg-warning-soft opacity-80',
};

function Bloco({
  appointment,
  topo,
  altura,
  faixa,
  faixas,
  arrastando,
  podeEditar,
  onPick,
  onPointerDown,
}: {
  appointment: Appointment;
  topo: number;
  altura: number;
  faixa: number;
  faixas: number;
  arrastando: boolean;
  podeEditar: boolean;
  onPick: () => void;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
}) {
  const largura = 100 / faixas;
  return (
    <button
      type="button"
      onClick={onPick}
      onPointerDown={onPointerDown}
      className={cn(
        'absolute overflow-hidden rounded-md border border-border px-1.5 py-1 text-left text-xs shadow-sm',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        TOM_DA_SITUACAO[appointment.status],
        podeEditar && 'cursor-grab',
        arrastando && 'z-20 cursor-grabbing opacity-90 shadow-lg',
      )}
      style={{
        top: `${topo}%`,
        height: `max(${altura}%, 1.5rem)`,
        left: `calc(${faixa * largura}% + 2px)`,
        width: `calc(${largura}% - 4px)`,
        borderLeft: appointment.mechanicColor ? `3px solid ${appointment.mechanicColor}` : undefined,
      }}
      title={`${appointment.title} — ${appointment.customerName} (${APPOINTMENT_STATUS_LABELS[appointment.status]})`}
    >
      <span className="block truncate font-medium">{appointment.title}</span>
      <span className="block truncate text-muted">{appointment.customerName}</span>
    </button>
  );
}
