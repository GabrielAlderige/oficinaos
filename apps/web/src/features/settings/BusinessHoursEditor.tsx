import { WEEKDAY_LABELS, WEEKDAYS, type BusinessHours } from '@oficinaos/shared';
import { Plus, X } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';

type Day = (typeof WEEKDAYS)[number];
type Interval = [string, string];

/**
 * Horário por dia da semana, com até 2 períodos (manhã e tarde, com almoço no
 * meio). Dia desmarcado = fechado (ausente no JSON).
 */
export function BusinessHoursEditor({ value, onChange, disabled }: {
  value: BusinessHours;
  onChange(value: BusinessHours): void;
  disabled?: boolean;
}) {
  function setDay(day: Day, intervals: Interval[]) {
    const next: BusinessHours = { ...value };
    if (intervals.length) next[day] = intervals;
    else delete next[day];
    onChange(next);
  }

  function addInterval(day: Day) {
    const current = (value[day] ?? []) as Interval[];
    const [first] = current;
    // um período só que atravessa o almoço vira manhã + tarde
    if (first && current.length === 1 && first[0] < '12:00' && first[1] > '13:00') {
      setDay(day, [[first[0], '12:00'], ['13:00', first[1]]]);
    } else {
      setDay(day, [...current, ['13:00', '18:00']]);
    }
  }

  return (
    <div className="divide-y divide-border rounded-lg border border-border">
      {WEEKDAYS.map((day) => {
        const intervals = (value[day] ?? []) as Interval[];
        const open = intervals.length > 0;
        const label = WEEKDAY_LABELS[day];
        return (
          <div key={day} className="flex min-h-12 flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2">
            <label className="flex w-28 items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                className="size-4"
                checked={open}
                disabled={disabled}
                onChange={(e) => setDay(day, e.target.checked ? [['08:00', day === 'sat' ? '12:00' : '18:00']] : [])}
              />
              {label}
            </label>
            {open ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                {intervals.map(([start, end], i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <Input
                      type="time"
                      aria-label={`${label}, início do período ${i + 1}`}
                      value={start}
                      disabled={disabled}
                      className="h-8 w-[6.75rem]"
                      onChange={(e) => setDay(day, intervals.map((iv, j): Interval => (j === i ? [e.target.value, iv[1]] : iv)))}
                    />
                    <span className="text-muted" aria-hidden="true">
                      até
                    </span>
                    <Input
                      type="time"
                      aria-label={`${label}, fim do período ${i + 1}`}
                      value={end}
                      disabled={disabled}
                      className="h-8 w-[6.75rem]"
                      onChange={(e) => setDay(day, intervals.map((iv, j): Interval => (j === i ? [iv[0], e.target.value] : iv)))}
                    />
                    {intervals.length > 1 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        disabled={disabled}
                        aria-label={`Remover período ${i + 1} de ${label}`}
                        onClick={() => setDay(day, intervals.filter((_, j) => j !== i))}
                      >
                        <X />
                      </Button>
                    )}
                  </div>
                ))}
                {intervals.length < 2 && (
                  <Button variant="ghost" size="sm" disabled={disabled} onClick={() => addInterval(day)}>
                    <Plus />
                    Intervalo
                  </Button>
                )}
              </div>
            ) : (
              <span className="text-sm text-muted">Fechado</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
