import { cn } from '../lib/cn';

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('size-7 shrink-0', className)} aria-hidden="true">
      <rect width="32" height="32" rx="8" className="fill-foreground" />
      <circle cx="16" cy="16" r="7" fill="none" stroke="#f26b1d" strokeWidth="3.5" />
    </svg>
  );
}

export function Brand({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn('flex items-center gap-2', className)}>
      <BrandMark />
      {!compact && (
        <span className="text-[15px] font-semibold tracking-tight">
          Oficina<span className="text-accent dark:text-accent-bright">OS</span>
        </span>
      )}
    </span>
  );
}

export function FullPageSpinner() {
  return (
    <div className="grid min-h-dvh place-items-center" role="status" aria-label="Carregando">
      <BrandMark className="size-10 motion-safe:animate-pulse" />
    </div>
  );
}
