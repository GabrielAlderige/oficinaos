import type { PageMeta } from '@oficinaos/shared';
import { ChevronLeft, ChevronRight, Search, X, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { Button } from './button';
import { inputClass } from './input';

/** Caixa de busca com lupa e botão de limpar. */
export function SearchInput({ value, onChange, placeholder, id, autoFocus, className, label }: {
  value: string;
  onChange(value: string): void;
  placeholder: string;
  label: string;
  id?: string;
  autoFocus?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
      <input
        id={id}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        autoFocus={autoFocus}
        autoComplete="off"
        className={cn(inputClass, 'pr-9 pl-9 [&::-webkit-search-cancel-button]:hidden')}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted hover:text-foreground"
          aria-label="Limpar busca"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}

/** "26–50 de 87" + anterior/próxima. A paginação é sempre do servidor. */
export function Pagination({ meta, onPageChange }: { meta: PageMeta; onPageChange(page: number): void }) {
  const pages = Math.max(1, Math.ceil(meta.total / meta.pageSize));
  const first = meta.total === 0 ? 0 : (meta.page - 1) * meta.pageSize + 1;
  const last = Math.min(meta.page * meta.pageSize, meta.total);
  if (meta.total <= meta.pageSize && meta.page === 1) return null;
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3 text-sm text-muted">
      <span className="tabular">
        {first}–{last} de {meta.total}
      </span>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" disabled={meta.page <= 1} onClick={() => onPageChange(meta.page - 1)}>
          <ChevronLeft />
          Anterior
        </Button>
        <Button variant="secondary" size="sm" disabled={meta.page >= pages} onClick={() => onPageChange(meta.page + 1)}>
          Próxima
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}

/** Estado vazio que ensina o próximo passo (e não só diz "nada aqui"). */
export function EmptyState({ icon: Icon, title, description, action, className }: {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-12 text-center', className)}>
      <span className="grid size-11 place-items-center rounded-full bg-surface-muted text-muted">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <p className="mt-3 font-medium">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
