import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { canonicalPlatePrefix, type SearchResult } from '@oficinaos/shared';
import { Car, Search, User } from 'lucide-react';
import { Dialog as D } from 'radix-ui';
import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router';
import { PlateBadge } from '../../components/plate-badge';
import { api } from '../../lib/api-client';
import { cn } from '../../lib/cn';
import { useCan } from '../../lib/session';
import { useDebouncedValue } from '../../lib/use-debounced-value';

interface Item {
  key: string;
  to: string;
  group: 'Veículos' | 'Clientes';
  title: string;
  subtitle: string;
  plate?: string | null;
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** Busca global (Ctrl+K / ⌘K): placa, nome, telefone ou documento, de qualquer tela. */
export function CommandMenu() {
  const canRead = useCan('customers:read');
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const query = useDebouncedValue(q.trim(), 200);

  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((current) => !current);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const results = useQuery({
    queryKey: ['search', query],
    queryFn: () => api<SearchResult>(`/search?q=${encodeURIComponent(query)}`),
    enabled: open && query.length >= 2,
    placeholderData: keepPreviousData,
  });

  const items = useMemo<Item[]>(() => {
    if (query.length < 2 || !results.data) return [];
    const vehicles: Item[] = results.data.vehicles.map((v) => ({
      key: `v-${v.id}`,
      to: `/veiculos/${v.id}`,
      group: 'Veículos',
      title: `${v.make} ${v.model}`,
      subtitle: v.customer.name,
      plate: v.plate,
    }));
    const customers: Item[] = results.data.customers.map((c) => ({
      key: `c-${c.id}`,
      to: `/clientes/${c.id}`,
      group: 'Clientes',
      title: c.name,
      subtitle: `${c.vehicleCount} ${c.vehicleCount === 1 ? 'veículo' : 'veículos'}`,
    }));
    // parece placa? carros primeiro; senão, pessoas primeiro
    return canonicalPlatePrefix(query) ? [...vehicles, ...customers] : [...customers, ...vehicles];
  }, [results.data, query]);

  useEffect(() => setActive(0), [query]);

  function go(item: Item | undefined) {
    if (!item) return;
    setOpen(false);
    setQ('');
    navigate(item.to);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((i) => Math.min(i + 1, items.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      go(items[active]);
    }
  }

  if (!canRead) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-9 min-w-0 items-center gap-2 rounded-md border border-border bg-surface px-3 text-sm text-muted hover:text-foreground sm:w-64"
        aria-label="Buscar placa, cliente ou telefone"
      >
        <Search className="size-4 shrink-0" />
        <span className="hidden truncate sm:inline">Buscar placa, cliente…</span>
        <kbd className="ml-auto hidden rounded border border-border px-1.5 font-sans text-[11px] sm:inline">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
      </button>

      <D.Root
        open={open}
        onOpenChange={(isOpen) => {
          setOpen(isOpen);
          if (!isOpen) setQ('');
        }}
      >
        <D.Portal>
          <D.Overlay className="fixed inset-0 z-50 bg-black/40 motion-safe:animate-[oos-fade-in_120ms_ease-out]" />
          <D.Content className="fixed top-[12vh] left-1/2 z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-surface shadow-2xl focus:outline-none motion-safe:animate-[oos-pop-in_140ms_ease-out]">
            <D.Title className="sr-only">Busca</D.Title>
            <D.Description className="sr-only">Busque por placa, nome, telefone ou documento</D.Description>
            <div className="flex items-center gap-2 border-b border-border px-4">
              <Search className="size-4 shrink-0 text-muted" aria-hidden="true" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Placa, nome, telefone ou documento"
                className="h-12 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted"
                role="combobox"
                aria-expanded={items.length > 0}
                aria-controls="command-results"
                aria-activedescendant={items[active] ? `cmd-${items[active].key}` : undefined}
              />
            </div>
            <div id="command-results" role="listbox" className="max-h-[60vh] overflow-y-auto p-2">
              {query.length < 2 ? (
                <p className="px-3 py-6 text-center text-sm text-muted">Digite pelo menos 2 letras ou números. A placa pode ser antiga ou Mercosul.</p>
              ) : !items.length ? (
                <p className="px-3 py-6 text-center text-sm text-muted">{results.isFetching ? 'Buscando…' : `Nada encontrado para “${query}”.`}</p>
              ) : (
                items.map((item, index) => {
                  const firstOfGroup = index === 0 || items[index - 1]!.group !== item.group;
                  const Icon = item.group === 'Veículos' ? Car : User;
                  return (
                    <div key={item.key}>
                      {firstOfGroup && <p className="px-3 pt-2 pb-1 text-xs font-medium text-muted">{item.group}</p>}
                      <div
                        id={`cmd-${item.key}`}
                        role="option"
                        aria-selected={index === active}
                        onMouseEnter={() => setActive(index)}
                        onClick={() => go(item)}
                        className={cn(
                          'flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2',
                          index === active && 'bg-surface-muted',
                        )}
                      >
                        {item.plate !== undefined ? <PlateBadge plate={item.plate} size="sm" /> : <Icon className="size-4 text-muted" aria-hidden="true" />}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{item.title}</span>
                          <span className="block truncate text-xs text-muted">{item.subtitle}</span>
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            <div className="flex gap-4 border-t border-border px-4 py-2 text-[11px] text-muted">
              <span>↑↓ navegar</span>
              <span>Enter abrir</span>
              <span>Esc fechar</span>
            </div>
          </D.Content>
        </D.Portal>
      </D.Root>
    </>
  );
}
