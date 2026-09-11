import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { SearchInput } from '../../components/ui/list-parts';
import { formatPlate } from '@oficinaos/shared';
import { useDebouncedValue } from '../../lib/use-debounced-value';
import { useCustomers } from './api';

export interface PickedCustomer {
  id: string;
  name: string;
}

/**
 * Escolher o cliente dentro de um formulário: busca por nome, telefone ou
 * placa, sem popover (dentro de diálogo, popover briga com o foco preso).
 */
export function CustomerSearchField({ id, value, onChange, invalid }: {
  id: string;
  value: PickedCustomer | null;
  onChange(customer: PickedCustomer | null): void;
  invalid?: boolean;
}) {
  const [q, setQ] = useState('');
  const debounced = useDebouncedValue(q, 250);
  const results = useCustomers({ q: debounced, page: 1, pageSize: 6 }, { enabled: !value });

  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface-muted/50 px-3 py-1.5">
        <span className="truncate text-sm font-medium">{value.name}</span>
        <Button variant="link" size="sm" onClick={() => onChange(null)}>
          Trocar
        </Button>
      </div>
    );
  }

  const rows = results.data?.data ?? [];
  return (
    <div className="space-y-1.5">
      <div aria-invalid={invalid || undefined} className="rounded-md aria-[invalid=true]:ring-1 aria-[invalid=true]:ring-danger">
        <SearchInput id={id} value={q} onChange={setQ} placeholder="Nome, telefone ou placa" label="Buscar cliente" />
      </div>
      <ul className="max-h-52 divide-y divide-border overflow-y-auto rounded-md border border-border" aria-label="Clientes encontrados">
        {rows.map((customer) => (
          <li key={customer.id}>
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-surface-muted"
              onClick={() => onChange({ id: customer.id, name: customer.name })}
            >
              <span className="truncate font-medium">{customer.name}</span>
              <span className="shrink-0 font-mono text-xs text-muted">{customer.plates.map(formatPlate).join(' · ')}</span>
            </button>
          </li>
        ))}
        {!rows.length && (
          <li className="px-3 py-3 text-sm text-muted">
            {results.isFetching ? 'Buscando…' : debounced ? 'Nenhum cliente encontrado.' : 'Nenhum cliente cadastrado ainda.'}
          </li>
        )}
      </ul>
    </div>
  );
}
