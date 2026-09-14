import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  daysBetween,
  businessIntervals,
  dayKey,
  dayPosition,
  findConflicts,
  formatMinutes,
  formatWhen,
  fromDayKey,
  gridBounds,
  isWithinBusinessHours,
  minutesOfDay,
  monthGrid,
  periodRange,
  overlaps,
  startOfWeek,
  wallClock,
  weekdayOf,
  type ScheduledSlot,
} from './calendar';
import type { BusinessHours } from './schemas/organization';

/** O pacote compartilhado não depende de Node; aqui só o teste mexe no fuso do processo. */
declare const process: { env: Record<string, string | undefined> };

const SP = 'America/Sao_Paulo';
const at = (iso: string) => new Date(iso);
const range = (startIso: string, endIso: string) => ({ startsAt: at(startIso), endsAt: at(endIso) });

describe('sobreposição de horário', () => {
  const base = range('2026-09-14T12:00:00Z', '2026-09-14T13:00:00Z');

  it('acusa sobreposição parcial dos dois lados', () => {
    expect(overlaps(base, range('2026-09-14T12:30:00Z', '2026-09-14T13:30:00Z'))).toBe(true);
    expect(overlaps(base, range('2026-09-14T11:30:00Z', '2026-09-14T12:30:00Z'))).toBe(true);
  });

  it('acusa quando um contém o outro, em qualquer ordem', () => {
    expect(overlaps(base, range('2026-09-14T12:15:00Z', '2026-09-14T12:45:00Z'))).toBe(true);
    expect(overlaps(base, range('2026-09-14T11:00:00Z', '2026-09-14T14:00:00Z'))).toBe(true);
  });

  it('encostar não é conflito: o intervalo é meio-aberto', () => {
    expect(overlaps(base, range('2026-09-14T13:00:00Z', '2026-09-14T14:00:00Z'))).toBe(false);
    expect(overlaps(base, range('2026-09-14T11:00:00Z', '2026-09-14T12:00:00Z'))).toBe(false);
  });

  it('não acusa horários separados', () => {
    expect(overlaps(base, range('2026-09-14T15:00:00Z', '2026-09-14T16:00:00Z'))).toBe(false);
  });
});

describe('conflitos na agenda', () => {
  const JOAO = '11111111-1111-1111-1111-111111111111';
  const MARIA = '22222222-2222-2222-2222-222222222222';

  const slot = (over: Partial<ScheduledSlot> = {}): ScheduledSlot => ({
    id: 'a1',
    status: 'SCHEDULED',
    mechanicUserId: JOAO,
    ...range('2026-09-14T12:00:00Z', '2026-09-14T13:00:00Z'),
    ...over,
  });

  const candidate = {
    ...range('2026-09-14T12:30:00Z', '2026-09-14T13:30:00Z'),
    mechanicUserId: JOAO,
  };

  it('encontra quem disputa a hora do mesmo mecânico', () => {
    expect(findConflicts(candidate, [slot()]).map((s) => s.id)).toEqual(['a1']);
  });

  it('mecânico diferente trabalha ao mesmo tempo sem conflito', () => {
    expect(findConflicts(candidate, [slot({ mechanicUserId: MARIA })])).toEqual([]);
  });

  it('agendamento sem mecânico não disputa a hora de ninguém', () => {
    expect(findConflicts({ ...candidate, mechanicUserId: null }, [slot()])).toEqual([]);
    expect(findConflicts(candidate, [slot({ mechanicUserId: null })])).toEqual([]);
    // nem entre si: dois compromissos sem dono não ocupam o mesmo lugar nenhum
    expect(findConflicts({ ...candidate, mechanicUserId: null }, [slot({ mechanicUserId: null })])).toEqual([]);
  });

  it('cancelado, não compareceu e concluído devolvem o horário', () => {
    expect(findConflicts(candidate, [slot({ status: 'CANCELED' })])).toEqual([]);
    expect(findConflicts(candidate, [slot({ status: 'NO_SHOW' })])).toEqual([]);
    expect(findConflicts(candidate, [slot({ status: 'COMPLETED' })])).toEqual([]);
    expect(findConflicts(candidate, [slot({ status: 'CONFIRMED' })])).toHaveLength(1);
    expect(findConflicts(candidate, [slot({ status: 'IN_PROGRESS' })])).toHaveLength(1);
  });

  it('ao reagendar, o agendamento não conflita consigo mesmo', () => {
    expect(findConflicts({ ...candidate, excludeId: 'a1' }, [slot()])).toEqual([]);
  });
});

describe('relógio da oficina', () => {
  it('lê a hora da parede da oficina, não a do processo', () => {
    const instant = at('2026-09-13T11:00:00Z');
    expect(wallClock(instant, SP)).toMatchObject({ year: 2026, month: 9, day: 13, hour: 8, minute: 0, weekday: 'sun' });
    expect(minutesOfDay(instant, SP)).toBe(8 * 60);
    // mesma oficina, mesmo instante, outro fuso: uma hora a menos
    expect(minutesOfDay(instant, 'America/Manaus')).toBe(7 * 60);
  });

  it('respeita o fuso da oficina mesmo com o processo em outro lugar', () => {
    const original = process.env.TZ;
    try {
      // do outro lado da linha de data: aqui já é dia 14
      process.env.TZ = 'Pacific/Kiritimati';
      const instant = at('2026-09-13T11:00:00Z');
      expect(dayKey(instant, SP)).toBe('2026-09-13');
      expect(minutesOfDay(instant, SP)).toBe(8 * 60);
      expect(fromDayKey('2026-09-13', 8 * 60, SP).toISOString()).toBe('2026-09-13T11:00:00.000Z');
    } finally {
      process.env.TZ = original;
    }
  });

  it('vai e volta entre parede e instante', () => {
    const instant = fromDayKey('2026-09-13', 8 * 60 + 30, SP);
    expect(instant.toISOString()).toBe('2026-09-13T11:30:00.000Z');
    expect(dayKey(instant, SP)).toBe('2026-09-13');
    expect(minutesOfDay(instant, SP)).toBe(8 * 60 + 30);
  });

  it('usa o deslocamento vigente no dia, e não um offset fixo (R11)', () => {
    // 15/01/2019 o Brasil estava no horário de verão (UTC−2); 15/07, não (UTC−3)
    expect(fromDayKey('2019-01-15', 8 * 60, SP).toISOString()).toBe('2019-01-15T10:00:00.000Z');
    expect(fromDayKey('2019-07-15', 8 * 60, SP).toISOString()).toBe('2019-07-15T11:00:00.000Z');
  });

  it('na hora que o horário de verão pula, cai na hora seguinte em vez de estourar', () => {
    // em 04/11/2018 a meia-noite virou 01:00: 00:30 não existiu na parede
    const instant = fromDayKey('2018-11-04', 30, SP);
    expect(minutesOfDay(instant, SP)).toBe(60 + 30);
    expect(dayKey(instant, SP)).toBe('2018-11-04');
  });

  it('recorta no dia o compromisso que atravessa a meia-noite', () => {
    const noite = range('2026-09-13T02:00:00Z', '2026-09-13T04:00:00Z'); // 23:00 → 01:00 em SP
    expect(dayPosition(noite, '2026-09-12', SP)).toEqual({ startMinutes: 23 * 60, endMinutes: 24 * 60 });
    expect(dayPosition(noite, '2026-09-13', SP)).toEqual({ startMinutes: 0, endMinutes: 60 });
    expect(dayPosition(noite, '2026-09-14', SP)).toBeNull();
  });
});

describe('navegação do calendário', () => {
  it('anda no calendário sem depender do tamanho do dia', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    // 04/11/2018 teve 23 horas no Brasil e mesmo assim é um dia só
    expect(addDays('2018-11-03', 1)).toBe('2018-11-04');
  });

  it('a semana começa na segunda', () => {
    expect(weekdayOf('2026-09-13')).toBe('sun');
    expect(startOfWeek('2026-09-13')).toBe('2026-09-07');
    expect(startOfWeek('2026-09-07')).toBe('2026-09-07');
  });

  it('a visão de mês tem 6 semanas fechadas começando na segunda', () => {
    const grid = monthGrid('2026-09-20');
    expect(grid).toHaveLength(42);
    expect(grid[0]).toBe('2026-08-31');
    expect(grid.at(-1)).toBe('2026-10-11');
    expect(weekdayOf(grid[0]!)).toBe('mon');
  });

  it('escreve a régua de horas', () => {
    expect(formatMinutes(8 * 60 + 5)).toBe('08:05');
    expect(formatMinutes(24 * 60)).toBe('00:00');
  });
});

describe('expediente da oficina', () => {
  const hours: BusinessHours = {
    mon: [['08:00', '12:00'], ['13:00', '18:00']],
    sat: [['08:00', '12:00']],
  };

  it('separa as faixas do dia; dia ausente é oficina fechada', () => {
    expect(businessIntervals(hours, 'mon')).toEqual([
      { startMinutes: 480, endMinutes: 720 },
      { startMinutes: 780, endMinutes: 1080 },
    ]);
    expect(businessIntervals(hours, 'sun')).toEqual([]);
  });

  it('a grade abre o bastante para caber o expediente da semana', () => {
    expect(gridBounds(hours)).toEqual({ startMinutes: 7 * 60, endMinutes: 19 * 60 });
    expect(gridBounds({ mon: [['06:30', '20:30']] })).toEqual({ startMinutes: 6 * 60, endMinutes: 21 * 60 });
    expect(gridBounds(null)).toEqual({ startMinutes: 7 * 60, endMinutes: 19 * 60 });
  });

  it('diz se o compromisso cabe dentro de uma faixa de expediente', () => {
    // 14/09/2026 é segunda
    const manha = range('2026-09-14T12:00:00Z', '2026-09-14T13:00:00Z'); // 09:00–10:00
    const almoco = range('2026-09-14T15:30:00Z', '2026-09-14T16:30:00Z'); // 12:30–13:30
    const domingo = range('2026-09-13T12:00:00Z', '2026-09-13T13:00:00Z');
    expect(isWithinBusinessHours(manha, hours, SP)).toBe(true);
    expect(isWithinBusinessHours(almoco, hours, SP)).toBe(false);
    expect(isWithinBusinessHours(domingo, hours, SP)).toBe(false);
  });
});

describe('mensagem para o cliente', () => {
  it('escreve o dia e a hora no relógio da oficina', () => {
    expect(formatWhen(at('2026-09-14T12:00:00Z'), SP)).toBe('segunda, 14/09, às 09:00');
    expect(formatWhen(at('2026-09-14T12:00:00Z'), 'America/Manaus')).toBe('segunda, 14/09, às 08:00');
  });
});

describe('período do dashboard', () => {
  // 2026-09-13 é um domingo; 11:00Z é 08:00 em SP e 07:00 em Manaus
  const agora = at('2026-09-13T11:00:00Z');

  it('"hoje" começa e termina no calendário da oficina', () => {
    const sp = periodRange('today', SP, undefined, agora);
    expect(sp.fromDay).toBe('2026-09-13');
    expect(sp.from.toISOString()).toBe('2026-09-13T03:00:00.000Z');
    expect(sp.to.toISOString()).toBe('2026-09-14T03:00:00.000Z');

    // a oficina de Manaus vira o dia uma hora depois
    const manaus = periodRange('today', 'America/Manaus', undefined, agora);
    expect(manaus.from.toISOString()).toBe('2026-09-13T04:00:00.000Z');
    expect(manaus.to.toISOString()).toBe('2026-09-14T04:00:00.000Z');
  });

  it('a semana começa na segunda e o mês pega o mês inteiro', () => {
    const semana = periodRange('week', SP, undefined, agora);
    expect([semana.fromDay, semana.toDay]).toEqual(['2026-09-07', '2026-09-13']);
    const mes = periodRange('month', SP, undefined, agora);
    expect([mes.fromDay, mes.toDay]).toEqual(['2026-09-01', '2026-09-30']);
  });

  it('período escolhido inclui o último dia inteiro, mesmo de trás para frente', () => {
    const escolhido = periodRange('custom', SP, { from: '2026-09-01', to: '2026-09-03' }, agora);
    expect(escolhido.to.toISOString()).toBe('2026-09-04T03:00:00.000Z');
    const invertido = periodRange('custom', SP, { from: '2026-09-03', to: '2026-09-01' }, agora);
    expect([invertido.fromDay, invertido.toDay]).toEqual(['2026-09-01', '2026-09-03']);
  });

  it('somar mês prende no último dia do mês curto', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-03-15', -1)).toBe('2026-02-15');
    expect(addMonths('2026-12-10', 1)).toBe('2027-01-10');
  });

  it('lista os dias do período para as colunas do gráfico', () => {
    expect(daysBetween('2026-09-28', '2026-10-02')).toEqual([
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
    ]);
  });
});
