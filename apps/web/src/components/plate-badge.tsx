import { formatPlate, isMercosulPlate } from '@oficinaos/shared';
import { cn } from '../lib/cn';

const sizes = {
  sm: 'text-[11px] min-w-[4.9rem]',
  md: 'text-[13px] min-w-[5.9rem]',
  lg: 'text-xl min-w-[9rem]',
} as const;

/**
 * A placa desenhada como placa: o olho acha o carro na lista antes de ler
 * (ARCHITECTURE §13.2). Mercosul com a faixa azul; antiga com a faixa cinza.
 * Continua branca no tema escuro, como a de verdade.
 */
export function PlateBadge({ plate, size = 'md', className }: {
  plate: string | null;
  size?: keyof typeof sizes;
  className?: string;
}) {
  if (!plate) {
    return (
      <span className={cn('inline-flex items-center rounded border border-dashed border-border px-1.5 py-0.5 text-xs text-muted', className)}>
        sem placa
      </span>
    );
  }
  const mercosul = isMercosulPlate(plate);
  return (
    <span
      className={cn(
        'inline-flex shrink-0 flex-col overflow-hidden rounded-[4px] border border-[#1f2937]/60 bg-white font-mono font-bold tracking-wider text-[#111827] shadow-xs dark:border-white/25',
        sizes[size],
        className,
      )}
      title={mercosul ? 'Placa Mercosul' : 'Placa modelo antigo'}
    >
      {mercosul ? (
        <span className="flex h-[0.72em] items-center justify-center bg-[#1d4ed8] text-[0.42em] font-semibold tracking-[0.25em] text-white">
          BRASIL
        </span>
      ) : (
        <span className="h-[0.3em] bg-[#9ca3af]" />
      )}
      <span className="px-1.5 py-[0.08em] text-center leading-tight">{formatPlate(plate)}</span>
    </span>
  );
}
