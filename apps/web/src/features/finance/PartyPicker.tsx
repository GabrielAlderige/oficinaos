import { useState } from 'react';
import { Field, fieldA11y } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { cn } from '../../lib/cn';
import { useDebouncedValue } from '../../lib/use-debounced-value';
import { useCustomers } from '../customers/api';

interface Escolhido {
  id: string;
  name: string;
}

/**
 * De quem se recebe. Busca em vez de lista inteira: uma
 * oficina com dois anos de casa tem milhares de clientes, e um `select` com
 * tudo dentro é inútil no celular.
 *
 * O campo é OPCIONAL de propósito: lançamento sem cliente (uma venda de balcão,
 * um acerto antigo) continua entrando.
 */
export function PartyPicker({ value, onChange, label }: {
  value: Escolhido | null;
  onChange(escolhido: Escolhido | null): void;
  label: string;
}) {
  const [texto, setTexto] = useState('');
  const q = useDebouncedValue(texto.trim(), 300);
  const buscando = q.length >= 2 && !value;

  const clientes = useCustomers({ q, page: 1, pageSize: 6 }, { enabled: buscando });
  const achados: Escolhido[] = (clientes.data?.data ?? []).map((c) => ({ id: c.id, name: c.name }));

  if (value) {
    return (
      <Field label={label} htmlFor="finance-party">
        <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface-muted px-3 py-2">
          <span className="min-w-0 truncate text-sm">{value.name}</span>
          <button
            type="button"
            className="shrink-0 text-xs text-muted underline hover:text-foreground"
            onClick={() => {
              onChange(null);
              setTexto('');
            }}
          >
            Trocar
          </button>
        </div>
      </Field>
    );
  }

  return (
    <Field label={label} htmlFor="finance-party" hint="Opcional. Digite para buscar.">
      <div className="relative">
        <Input
          {...fieldA11y('finance-party', undefined, true)}
          value={texto}
          onChange={(event) => setTexto(event.target.value)}
          placeholder="Nome do cliente"
          autoComplete="off"
        />
        {buscando && achados.length > 0 && (
          <ul className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-border bg-surface shadow-lg">
            {achados.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={cn('block w-full truncate px-3 py-2 text-left text-sm hover:bg-surface-muted')}
                  onClick={() => onChange(item)}
                >
                  {item.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Field>
  );
}
