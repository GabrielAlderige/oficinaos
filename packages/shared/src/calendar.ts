/**
 * Agenda: conflito de horário e relógio da oficina (docs/DATABASE.md §5.4,
 * risco R11 em docs/ARCHITECTURE.md §12).
 *
 * Tudo trafega e é guardado como instante (`timestamptz`). A grade, porém, é
 * desenhada no **relógio da oficina**: um horário das 08:00 em São Paulo tem de
 * aparecer às 08:00 mesmo que o navegador esteja em Manaus ou o servidor em UTC.
 * Por isso a conversão instante ↔ parede mora aqui, e não no componente.
 *
 * Sem biblioteca de data de propósito (D28): `Intl.DateTimeFormat` com
 * `timeZone` já resolve os dois sentidos, inclusive horário de verão.
 */

import { BLOCKING_APPOINTMENT_STATUSES, type AppointmentStatus } from './enums/appointments';
import { WEEKDAYS, WEEKDAY_LABELS, type BusinessHours } from './schemas/organization';

export type WeekdayKey = (typeof WEEKDAYS)[number];

/** `getUTCDay()` começa no domingo; `WEEKDAYS`, na segunda. */
const WEEKDAY_BY_INDEX: readonly WeekdayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export const MINUTES_IN_DAY = 24 * 60;

// ------------------------------- conflito ---------------------------------

export interface TimeRange {
  startsAt: Date;
  endsAt: Date;
}

/**
 * Sobreposição em intervalo **meio-aberto**: 09:00–10:00 e 10:00–11:00 se
 * encostam, e encostar não é conflito. Se fosse fechado, a agenda acusaria
 * conflito em toda sequência normal de horários.
 */
export function overlaps(a: TimeRange, b: TimeRange): boolean {
  return a.startsAt.getTime() < b.endsAt.getTime() && b.startsAt.getTime() < a.endsAt.getTime();
}

export interface ConflictCandidate extends TimeRange {
  /** nulo = sem mecânico definido; não disputa a hora de ninguém */
  mechanicUserId: string | null;
  /** ao reagendar, o próprio agendamento não conflita consigo mesmo */
  excludeId?: string | null;
}

export interface ScheduledSlot extends TimeRange {
  id: string;
  status: AppointmentStatus;
  mechanicUserId: string | null;
}

/** Cancelado, não compareceu e concluído devolvem o horário para a agenda. */
export function isBlocking(status: AppointmentStatus): boolean {
  return (BLOCKING_APPOINTMENT_STATUSES as readonly AppointmentStatus[]).includes(status);
}

/**
 * Agendamentos que disputam a mesma hora do mesmo mecânico. O resultado é
 * **aviso**, não bloqueio: oficina de verdade encaixa cliente, e travar faria a
 * oficina marcar por fora do sistema (§5.4).
 */
export function findConflicts<T extends ScheduledSlot>(
  candidate: ConflictCandidate,
  existing: readonly T[],
): T[] {
  if (!candidate.mechanicUserId) return [];
  return existing.filter(
    (slot) =>
      slot.id !== candidate.excludeId &&
      slot.mechanicUserId === candidate.mechanicUserId &&
      isBlocking(slot.status) &&
      overlaps(candidate, slot),
  );
}

// -------------------------- relógio da oficina ----------------------------

export interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: WeekdayKey;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Que horas são, na parede da oficina, no instante dado. */
export function wallClock(instant: Date, timeZone: string): WallClock {
  const parts: Record<string, string> = {};
  for (const part of formatterFor(timeZone).formatToParts(instant)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  // o dia da semana sai do próprio calendário local, sem depender do idioma
  const weekdayIndex = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return {
    year,
    month,
    day,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAY_BY_INDEX[weekdayIndex]!,
  };
}

/** Diferença entre a parede da oficina e o UTC naquele instante, em milissegundos. */
function offsetMs(instant: Date, timeZone: string): number {
  const wall = wallClock(instant, timeZone);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return asUtc - instant.getTime();
}

export interface CalendarDay {
  year: number;
  month: number;
  day: number;
}

/**
 * Caminho inverso: "13/09 às 08:00 na oficina" vira instante.
 *
 * Duas passadas porque o deslocamento depende do próprio instante que estamos
 * procurando: a primeira chuta com o deslocamento do horário-parede lido como
 * UTC, a segunda corrige com o deslocamento vigente no chute. Quando as duas
 * discordam, a virada do horário de verão está no meio:
 *
 * - a hora **existiu duas vezes** (relógio atrasou): vale a primeira passagem;
 * - a hora **não existiu** (relógio adiantou): nenhuma das duas bate com a
 *   parede, e entregamos o fim do salto — 00:30 numa noite que pulou a
 *   meia-noite vira 01:30, e não 23:30 do dia anterior.
 */
export function fromWallClock(day: CalendarDay, minutes: number, timeZone: string): Date {
  const asUtc = Date.UTC(day.year, day.month - 1, day.day, 0, minutes);
  const first = asUtc - offsetMs(new Date(asUtc), timeZone);
  const second = asUtc - offsetMs(new Date(first), timeZone);
  if (first === second) return new Date(first);

  // `asUtc` já normalizou o pedido (minuto 1500 vira 01:00 do dia seguinte)
  const wanted = new Date(asUtc);
  const matchesWall = (timestamp: number) => {
    const wall = wallClock(new Date(timestamp), timeZone);
    return (
      wall.year === wanted.getUTCFullYear() &&
      wall.month === wanted.getUTCMonth() + 1 &&
      wall.day === wanted.getUTCDate() &&
      wall.hour === wanted.getUTCHours() &&
      wall.minute === wanted.getUTCMinutes()
    );
  };
  if (matchesWall(first)) return new Date(first);
  if (matchesWall(second)) return new Date(second);
  return new Date(Math.max(first, second));
}

/** "2026-09-13" mais 480 minutos → instante das 08:00 na oficina. */
export function fromDayKey(key: string, minutes: number, timeZone: string): Date {
  return fromWallClock(parseDayKey(key), minutes, timeZone);
}

export function toDayKey(day: CalendarDay): string {
  const pad = (value: number, size = 2) => String(value).padStart(size, '0');
  return `${pad(day.year, 4)}-${pad(day.month)}-${pad(day.day)}`;
}

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "2026-09-13" de volta em números. Chave torta é erro de programação, não de dado. */
export function parseDayKey(key: string): CalendarDay {
  const match = DAY_KEY.exec(key);
  if (!match) throw new Error(`Dia inválido: ${key}`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/** Chave estável do dia na oficina: "2026-09-13". É como a grade agrupa. */
export function dayKey(instant: Date, timeZone: string): string {
  return toDayKey(wallClock(instant, timeZone));
}

/** Minutos desde a meia-noite da oficina: é a coordenada vertical do bloco. */
export function minutesOfDay(instant: Date, timeZone: string): number {
  const wall = wallClock(instant, timeZone);
  return wall.hour * 60 + wall.minute;
}

/**
 * Onde o bloco começa e termina **dentro daquele dia**, em minutos. O que
 * atravessa a meia-noite é recortado, senão transbordaria a coluna.
 */
export function dayPosition(
  range: TimeRange,
  key: string,
  timeZone: string,
): { startMinutes: number; endMinutes: number } | null {
  const dayStart = fromDayKey(key, 0, timeZone).getTime();
  const dayEnd = fromDayKey(key, MINUTES_IN_DAY, timeZone).getTime();
  const start = range.startsAt.getTime();
  const end = range.endsAt.getTime();
  if (start >= dayEnd || end <= dayStart) return null;
  return {
    startMinutes: Math.max(0, Math.round((start - dayStart) / 60_000)),
    endMinutes: Math.min(MINUTES_IN_DAY, Math.round((end - dayStart) / 60_000)),
  };
}

/** Soma dias no calendário, sem cair na armadilha do dia de 23 h do verão. */
export function addDays(key: string, days: number): string {
  const { year, month, day } = parseDayKey(key);
  const moved = new Date(Date.UTC(year, month - 1, day + days));
  return toDayKey({
    year: moved.getUTCFullYear(),
    month: moved.getUTCMonth() + 1,
    day: moved.getUTCDate(),
  });
}

export function weekdayOf(key: string): WeekdayKey {
  const { year, month, day } = parseDayKey(key);
  return WEEKDAY_BY_INDEX[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]!;
}

/** Segunda-feira daquela semana: a visão de semana começa nela. */
export function startOfWeek(key: string): string {
  return addDays(key, -WEEKDAYS.indexOf(weekdayOf(key)));
}

export function startOfMonth(key: string): string {
  return toDayKey({ ...parseDayKey(key), day: 1 });
}

/** Os 42 dias da visão de mês: começa na segunda e fecha 6 semanas. */
export function monthGrid(key: string): string[] {
  const first = startOfWeek(startOfMonth(key));
  return Array.from({ length: 42 }, (_, index) => addDays(first, index));
}

/** "08:30" a partir de minutos. A régua de horas da grade é escrita com isto. */
export function formatMinutes(minutes: number): string {
  const normalized = ((minutes % MINUTES_IN_DAY) + MINUTES_IN_DAY) % MINUTES_IN_DAY;
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(Math.floor(normalized / 60))}:${pad(normalized % 60)}`;
}

const TIME = /^(\d{2}):(\d{2})$/;

/** "08:30" em minutos desde a meia-noite. É o formato do `business_hours`. */
/** "segunda, 14/09" no relógio da oficina. */
export function formatDayLabel(instant: Date, timeZone: string): string {
  const wall = wallClock(instant, timeZone);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${WEEKDAY_LABELS[wall.weekday].toLowerCase()}, ${pad(wall.day)}/${pad(wall.month)}`;
}

/** "segunda, 14/09, às 09:00" — como a oficina fala com o cliente. */
export function formatWhen(instant: Date, timeZone: string): string {
  return `${formatDayLabel(instant, timeZone)}, às ${formatMinutes(minutesOfDay(instant, timeZone))}`;
}

export function parseTime(time: string): number {
  const match = TIME.exec(time);
  if (!match) throw new Error(`Hora inválida: ${time}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

// ----------------------------- expediente ---------------------------------

/** Faixas de expediente do dia, em minutos. Dia ausente = oficina fechada. */
export function businessIntervals(
  hours: BusinessHours | null | undefined,
  weekday: WeekdayKey,
): { startMinutes: number; endMinutes: number }[] {
  return (hours?.[weekday] ?? []).map(([start, end]) => ({
    startMinutes: parseTime(start),
    endMinutes: parseTime(end),
  }));
}

/**
 * Até onde a grade desenha. Parte de 07:00–19:00 e abre o suficiente para caber
 * o expediente da semana inteira — a oficina que abre às 6 h não pode ter a
 * primeira hora escondida.
 */
export function gridBounds(hours: BusinessHours | null | undefined): {
  startMinutes: number;
  endMinutes: number;
} {
  let start = 7 * 60;
  let end = 19 * 60;
  for (const weekday of WEEKDAYS) {
    for (const interval of businessIntervals(hours, weekday)) {
      start = Math.min(start, Math.floor(interval.startMinutes / 60) * 60);
      end = Math.max(end, Math.ceil(interval.endMinutes / 60) * 60);
    }
  }
  return { startMinutes: start, endMinutes: Math.max(end, start + 60) };
}

/**
 * O compromisso cabe inteiro dentro de uma faixa de expediente? Vira aviso na
 * tela ("fora do horário de funcionamento"), nunca impedimento: encaixe de
 * sábado à tarde acontece.
 */
export function isWithinBusinessHours(
  range: TimeRange,
  hours: BusinessHours | null | undefined,
  timeZone: string,
): boolean {
  const key = dayKey(range.startsAt, timeZone);
  const position = dayPosition(range, key, timeZone);
  if (!position) return false;
  // atravessou a meia-noite: nenhum expediente de um dia só comporta isso
  if (dayKey(new Date(range.endsAt.getTime() - 1), timeZone) !== key) return false;
  return businessIntervals(hours, weekdayOf(key)).some(
    (interval) =>
      position.startMinutes >= interval.startMinutes && position.endMinutes <= interval.endMinutes,
  );
}
