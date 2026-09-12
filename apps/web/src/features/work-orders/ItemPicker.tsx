import { formatBRL, formatDuration, type WorkOrderItemInput } from '@oficinaos/shared';
import { Package, Plus, Wrench } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Field, fieldA11y } from '../../components/ui/field';
import { AdornedInput, Input } from '../../components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '../../components/ui/overlays';
import { cn } from '../../lib/cn';
import { SearchInput } from '../../components/ui/list-parts';
import { useDebouncedValue } from '../../lib/use-debounced-value';
import { useParts, useServices } from '../catalog/api';
import { formatQty } from '../catalog/stock';
import { parseBRL, parseQuantity } from '@oficinaos/shared';

type Tab = 'SERVICE' | 'PART' | 'FREE';

const TABS: { key: Tab; label: string }[] = [
  { key: 'SERVICE', label: 'Serviços' },
  { key: 'PART', label: 'Peças' },
  { key: 'FREE', label: 'Item avulso' },
];

/**
 * Escolher o que entra na OS. O preço vem do catálogo (a API confirma), e o
 * item avulso cobre o que a oficina comprou fora ou não tem cadastrado — sem
 * isso, a pessoa abandona a tela e volta pro papel.
 */
export function ItemPicker({ open, onOpenChange, onPick, busy }: {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** `label` é o nome legível: no assistente a OS ainda não existe para devolvê-lo */
  onPick(item: WorkOrderItemInput, label: string): Promise<unknown> | void;
  busy?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <PickerBody onPick={onPick} onDone={() => onOpenChange(false)} busy={busy} />
      </DialogContent>
    </Dialog>
  );
}

function PickerBody({ onPick, onDone, busy }: {
  onPick(item: WorkOrderItemInput, label: string): Promise<unknown> | void;
  onDone(): void;
  busy?: boolean;
}) {
  const [tab, setTab] = useState<Tab>('SERVICE');
  const [search, setSearch] = useState('');
  const q = useDebouncedValue(search.trim(), 250);

  const services = useServices({ q, status: 'active', page: 1, pageSize: 8 }, { enabled: tab === 'SERVICE' });
  const parts = useParts({ q, attention: false, page: 1, pageSize: 8 }, { enabled: tab === 'PART' });

  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [isPart, setIsPart] = useState(false);
  const freePrice = parseBRL(price || 'x');
  const freeInvalid = description.trim().length < 2 || freePrice === null;

  async function pick(item: WorkOrderItemInput, label: string) {
    await onPick(item, label);
    onDone();
  }

  return (
    <>
      <DialogHeader title="Adicionar à OS" description="Busque no catálogo ou lance um item avulso." />
      <div className="space-y-4">
        <div role="tablist" aria-label="Tipo de item" className="inline-flex rounded-lg border border-border p-0.5">
          {TABS.map((option) => (
            <button
              key={option.key}
              type="button"
              role="tab"
              aria-selected={tab === option.key}
              onClick={() => setTab(option.key)}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm transition-colors',
                tab === option.key ? 'bg-surface-muted font-medium text-foreground' : 'text-muted hover:text-foreground',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        {tab === 'FREE' ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Descrição" htmlFor="free-description" className="sm:col-span-2">
              <Input
                {...fieldA11y('free-description')}
                autoFocus
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Ex.: retífica do cabeçote (serviço de terceiro)"
              />
            </Field>
            <Field label="Preço" htmlFor="free-price">
              <AdornedInput
                leading="R$"
                {...fieldA11y('free-price')}
                inputMode="decimal"
                value={price}
                onChange={(event) => setPrice(event.target.value)}
                placeholder="0,00"
              />
            </Field>
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <input type="checkbox" className="size-4" checked={isPart} onChange={(event) => setIsPart(event.target.checked)} />
              É peça (não mão de obra)
            </label>
            <div className="sm:col-span-2">
              <Button
                disabled={freeInvalid || busy}
                loading={busy}
                onClick={() =>
                  void pick(
                    {
                      type: isPart ? 'PART' : 'SERVICE',
                      description: description.trim(),
                      unitPriceCents: freePrice ?? 0,
                    },
                    description.trim(),
                  )
                }
              >
                <Plus />
                Adicionar item avulso
              </Button>
            </div>
          </div>
        ) : (
          <>
            <SearchInput
              value={search}
              onChange={setSearch}
              autoFocus
              label={tab === 'SERVICE' ? 'Buscar serviços' : 'Buscar peças'}
              placeholder={tab === 'SERVICE' ? 'Nome ou categoria do serviço' : 'Nome, código, marca ou carro'}
            />
            <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border">
              {tab === 'SERVICE' &&
                (services.data?.data ?? []).map((service) => (
                  <li key={service.id}>
                    <button
                      type="button"
                      disabled={busy || service.effectivePriceCents === null}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-surface-muted disabled:opacity-50"
                      onClick={() => void pick({ type: 'SERVICE', serviceId: service.id }, service.name)}
                    >
                      <span className="min-w-0">
                        <span className="flex items-center gap-2 text-sm font-medium">
                          <Wrench className="size-3.5 text-muted" aria-hidden="true" />
                          <span className="truncate">{service.name}</span>
                        </span>
                        <span className="block truncate text-xs text-muted">
                          {[service.category, service.estimatedMinutes && formatDuration(service.estimatedMinutes)]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </span>
                      <span className="shrink-0 text-sm font-medium tabular">
                        {service.effectivePriceCents !== null ? (
                          formatBRL(service.effectivePriceCents)
                        ) : (
                          <span className="text-xs font-normal text-warning">Sem hora técnica</span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}

              {tab === 'PART' &&
                (parts.data?.data ?? []).map((part) => (
                  <li key={part.id}>
                    <button
                      type="button"
                      disabled={busy || part.salePriceCents === null}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-surface-muted disabled:opacity-50"
                      onClick={() => void pick({ type: 'PART', partId: part.id }, part.name)}
                    >
                      <span className="min-w-0">
                        <span className="flex items-center gap-2 text-sm font-medium">
                          <Package className="size-3.5 text-muted" aria-hidden="true" />
                          <span className="truncate">{part.name}</span>
                        </span>
                        <span className="block truncate text-xs text-muted">
                          {[part.manufacturer, part.manufacturerCode, `disponível: ${formatQty(part.quantityAvailable, part.unit)}`]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </span>
                      <span className="shrink-0 text-sm font-medium tabular">
                        {part.salePriceCents !== null ? (
                          formatBRL(part.salePriceCents)
                        ) : (
                          <span className="text-xs font-normal text-muted">Sem preço</span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}

              {((tab === 'SERVICE' && !services.data?.data.length) || (tab === 'PART' && !parts.data?.data.length)) && (
                <li className="px-3 py-4 text-center text-sm text-muted">
                  {q ? `Nada encontrado para “${q}”.` : 'Nada cadastrado ainda. Use o item avulso.'}
                </li>
              )}
            </ul>
            <p className="text-xs text-muted">
              Quantidade e preço podem ser ajustados depois, direto na linha da OS.
            </p>
          </>
        )}
      </div>
      <DialogFooter>
        <Button variant="secondary" onClick={onDone}>
          Fechar
        </Button>
      </DialogFooter>
    </>
  );
}

/** Converte o que a pessoa digitou numa quantidade válida (ou null). */
export const parseTypedQuantity = (text: string) => {
  const milli = parseQuantity(text || 'x');
  return milli === null || milli <= 0 ? null : milli / 1000;
};
