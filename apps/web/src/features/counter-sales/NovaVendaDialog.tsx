import {
  counterSaleTotals,
  formatBRL,
  formatBRLInput,
  formatQuantity,
  parseBRL,
  parseQuantity,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  type PaymentMethod,
} from '@oficinaos/shared';
import { PackagePlus, Plus, Search, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Alert } from '../../components/ui/display';
import { Field, fieldA11y, Select } from '../../components/ui/field';
import { AdornedInput, Input, Textarea } from '../../components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '../../components/ui/overlays';
import { cn } from '../../lib/cn';
import { errorMessage } from '../../lib/errors';
import { useCan } from '../../lib/session';
import { useDebouncedValue } from '../../lib/use-debounced-value';
import { useParts } from '../catalog/api';
import { PartyPicker } from '../finance/PartyPicker';
import { PosChargeFlow } from '../pos/PosCharge';
import { useCreateCounterSale } from './api';

interface Linha {
  chave: string;
  partId: string | null;
  description: string;
  /** como a pessoa digitou: "1", "4,5" */
  quantidade: string;
  /** "45,00" */
  preco: string;
  disponivel: number | null;
}

const hojeMais = (dias: number) => {
  const data = new Date(Date.now() + dias * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(data);
};

const milliDe = (texto: string) => parseQuantity(Number(texto.replace(',', '.')) || 0) ?? 0;

/**
 * Nova venda de balcão (E49). Busca a peça pelo nome ou código, ajusta
 * quantidade e preço e fecha: pago na hora (com a forma) ou fiado (com o
 * cliente e o vencimento). A peça sai do estoque no mesmo clique.
 */
export function NovaVendaDialog({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">{open && <Formulario onDone={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  );
}

function Formulario({ onDone }: { onDone(): void }) {
  const criar = useCreateCounterSale();
  const podeDesconto = useCan('work_orders:discount');
  // gerado ao abrir: o clique duplo no "Concluir" manda a mesma chave
  const [clientRequestId] = useState(() => crypto.randomUUID());
  const [cliente, setCliente] = useState<{ id: string; name: string } | null>(null);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [busca, setBusca] = useState('');
  const q = useDebouncedValue(busca.trim(), 250);
  const pecas = useParts({ q, page: 1, pageSize: 6, attention: false }, { enabled: q.length >= 2 });
  const [desconto, setDesconto] = useState('');
  const [forma, setForma] = useState<'PAID' | 'LATER' | 'POS'>('PAID');
  const podeMaquininha = useCan('payments:record');
  /** venda gravada esperando a maquininha: a tela troca para a cobrança */
  const [naMaquininha, setNaMaquininha] = useState<{ id: string; totalCents: number } | null>(null);
  const [metodo, setMetodo] = useState<PaymentMethod>('PIX');
  const [vencimento, setVencimento] = useState(() => hojeMais(30));
  const [observacao, setObservacao] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  const totais = counterSaleTotals(
    linhas.map((linha) => ({ quantityMilli: milliDe(linha.quantidade), unitPriceCents: parseBRL(linha.preco || '0') ?? 0 })),
    parseBRL(desconto || '0') ?? 0,
  );

  function adicionarPeca(peca: { id: string; name: string; salePriceCents: number | null; quantityAvailable: number }) {
    setLinhas((atuais) => {
      const existente = atuais.find((linha) => linha.partId === peca.id);
      if (existente) {
        // a mesma peça de novo soma na linha que já está lá
        return atuais.map((linha) =>
          linha === existente
            ? { ...linha, quantidade: String(milliDe(linha.quantidade) / 1000 + 1).replace('.', ',') }
            : linha,
        );
      }
      return [
        ...atuais,
        {
          chave: crypto.randomUUID(),
          partId: peca.id,
          description: peca.name,
          quantidade: '1',
          preco: formatBRLInput(peca.salePriceCents ?? 0),
          disponivel: peca.quantityAvailable,
        },
      ];
    });
    setBusca('');
  }

  function adicionarAvulso() {
    setLinhas((atuais) => [
      ...atuais,
      { chave: crypto.randomUUID(), partId: null, description: '', quantidade: '1', preco: '', disponivel: null },
    ]);
  }

  const mudar = (chave: string, patch: Partial<Linha>) =>
    setLinhas((atuais) => atuais.map((linha) => (linha.chave === chave ? { ...linha, ...patch } : linha)));

  async function concluir() {
    setErro(null);
    if (!linhas.length) return setErro('Adicione pelo menos uma peça ou item.');
    if (linhas.some((linha) => milliDe(linha.quantidade) <= 0)) return setErro('Toda linha precisa de quantidade.');
    if (linhas.some((linha) => !linha.partId && linha.description.trim().length < 2)) {
      return setErro('Escreva o que foi vendido no item avulso.');
    }
    if (forma === 'LATER' && !cliente) return setErro('Para vender fiado, escolha o cliente.');
    try {
      const venda = await criar.mutateAsync({
        clientRequestId,
        customerId: cliente?.id ?? null,
        items: linhas.map((linha) => ({
          partId: linha.partId,
          description: linha.description.trim(),
          quantity: milliDe(linha.quantidade) / 1000,
          unitPriceCents: parseBRL(linha.preco || '0') ?? 0,
        })),
        discountCents: parseBRL(desconto || '0') ?? 0,
        payment: forma === 'PAID' ? { kind: 'PAID', method: metodo } : forma === 'POS' ? { kind: 'POS' } : { kind: 'LATER', dueDate: vencimento },
        notes: observacao,
      });
      for (const peca of venda.negativeStock) {
        toast.warning(`${peca.name} ficou com estoque negativo. Confira a contagem.`);
      }
      if (forma === 'POS' && venda.totalCents > 0) {
        setNaMaquininha({ id: venda.id, totalCents: venda.totalCents });
        return;
      }
      toast.success(`Venda ${venda.number} concluída: ${formatBRL(venda.totalCents)}.`);
      onDone();
    } catch (err) {
      setErro(errorMessage(err));
    }
  }

  if (naMaquininha) {
    // a venda já está gravada (a peça já saiu): fechar aqui deixa a conta em aberto no financeiro
    return <PosChargeFlow origem={{ counterSaleId: naMaquininha.id }} valorCents={naMaquininha.totalCents} onClose={onDone} />;
  }

  return (
    <>
      <DialogHeader title="Nova venda de balcão" description="A peça sai do estoque e a venda entra no financeiro na hora." />
      <div className="grid gap-4">
        <PartyPicker label="Cliente" value={cliente} onChange={setCliente} />

        <Field label="Peça" htmlFor="balcao-busca" hint="Nome, código interno ou código do fabricante.">
          <div className="relative">
            <AdornedInput
              {...fieldA11y('balcao-busca', undefined, true)}
              value={busca}
              onChange={(event) => setBusca(event.target.value)}
              placeholder="Buscar peça"
              autoComplete="off"
              autoFocus
            />
            <Search className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
            {q.length >= 2 && (
              <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-border bg-surface shadow-lg">
                {pecas.isPending ? (
                  <li className="px-3 py-2 text-sm text-muted">Buscando…</li>
                ) : !pecas.data?.data.length ? (
                  <li className="px-3 py-2 text-sm text-muted">Nenhuma peça com “{q}”.</li>
                ) : (
                  pecas.data.data.map((peca) => (
                    <li key={peca.id}>
                      <button
                        type="button"
                        onClick={() => adicionarPeca(peca)}
                        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-surface-muted"
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{peca.name}</span>
                          <span className="block truncate text-xs text-muted">
                            {[peca.sku, peca.manufacturer].filter(Boolean).join(' · ') || 'sem código'} · disponível{' '}
                            {formatQuantity(Math.round(peca.quantityAvailable * 1000), peca.unit)}
                          </span>
                        </span>
                        <span className="shrink-0 tabular">{peca.salePriceCents === null ? 'sem preço' : formatBRL(peca.salePriceCents)}</span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            )}
          </div>
        </Field>

        {linhas.length > 0 && (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {linhas.map((linha) => {
              const totalLinha = counterSaleTotals(
                [{ quantityMilli: milliDe(linha.quantidade), unitPriceCents: parseBRL(linha.preco || '0') ?? 0 }],
                0,
              ).totalCents;
              const falta = linha.disponivel !== null && milliDe(linha.quantidade) > Math.round(linha.disponivel * 1000);
              return (
                <li key={linha.chave} className="grid gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_5rem_7.5rem_6rem_2rem] sm:items-center">
                  {linha.partId ? (
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{linha.description}</span>
                      {falta && <span className="text-xs text-warning">Mais do que o disponível no estoque</span>}
                    </span>
                  ) : (
                    <Input
                      aria-label="O que foi vendido"
                      value={linha.description}
                      onChange={(event) => mudar(linha.chave, { description: event.target.value })}
                      placeholder="Item avulso (ex.: troca da lâmpada)"
                      maxLength={200}
                    />
                  )}
                  <Input
                    aria-label={`Quantidade de ${linha.description || 'item avulso'}`}
                    inputMode="decimal"
                    value={linha.quantidade}
                    onChange={(event) => mudar(linha.chave, { quantidade: event.target.value.replace(/[^\d,.]/g, '') })}
                  />
                  <AdornedInput
                    aria-label={`Preço de ${linha.description || 'item avulso'}`}
                    leading="R$"
                    inputMode="numeric"
                    value={linha.preco}
                    onChange={(event) => mudar(linha.chave, { preco: formatBRLInput(parseBRL(event.target.value) ?? 0) })}
                  />
                  <span className="text-right text-sm font-medium tabular">{formatBRL(totalLinha)}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    aria-label={`Tirar ${linha.description || 'item avulso'}`}
                    onClick={() => setLinhas((atuais) => atuais.filter((outra) => outra.chave !== linha.chave))}
                  >
                    <Trash2 />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        <div>
          <Button variant="ghost" size="sm" onClick={adicionarAvulso}>
            <PackagePlus />
            Item avulso (sem estoque)
          </Button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {podeDesconto && (
            <Field label="Desconto" htmlFor="balcao-desconto">
              <AdornedInput
                {...fieldA11y('balcao-desconto')}
                leading="R$"
                inputMode="numeric"
                value={desconto}
                onChange={(event) => setDesconto(formatBRLInput(parseBRL(event.target.value) ?? 0))}
              />
            </Field>
          )}
          <div className={cn('rounded-lg bg-surface-muted px-4 py-3', !podeDesconto && 'sm:col-span-2')}>
            {totais.discountCents > 0 && (
              <p className="flex justify-between text-sm text-muted">
                <span>Subtotal</span>
                <span className="tabular">{formatBRL(totais.subtotalCents)}</span>
              </p>
            )}
            <p className="flex items-baseline justify-between text-lg font-semibold">
              <span>Total</span>
              <span className="tabular">{formatBRL(totais.totalCents)}</span>
            </p>
          </div>
        </div>

        <fieldset className="grid gap-3">
          <legend className="mb-1.5 text-sm font-medium">Pagamento</legend>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ['PAID', 'Pago agora'],
                ...(podeMaquininha ? ([['POS', 'Na maquininha']] as const) : []),
                ['LATER', 'Fiado (a receber)'],
              ] as const
            ).map(([valor, rotulo]) => (
              <button
                key={valor}
                type="button"
                aria-pressed={forma === valor}
                onClick={() => setForma(valor)}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-sm transition-colors',
                  forma === valor
                    ? 'border-accent bg-accent-soft font-medium text-accent dark:text-accent-bright'
                    : 'border-border text-muted hover:text-foreground',
                )}
              >
                {rotulo}
              </button>
            ))}
          </div>
          {forma === 'POS' ? (
            <p className="text-sm text-muted">Ao concluir, o valor vai direto para a maquininha Stone.</p>
          ) : forma === 'PAID' ? (
            <Field label="Forma de pagamento" htmlFor="balcao-metodo">
              <Select id="balcao-metodo" value={metodo} onChange={(event) => setMetodo(event.target.value as PaymentMethod)}>
                {PAYMENT_METHODS.map((valor) => (
                  <option key={valor} value={valor}>
                    {PAYMENT_METHOD_LABELS[valor]}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <Field label="Vencimento" htmlFor="balcao-vencimento" hint="Vira conta a receber do cliente no financeiro.">
              <Input
                {...fieldA11y('balcao-vencimento', undefined, true)}
                type="date"
                value={vencimento}
                onChange={(event) => setVencimento(event.target.value)}
              />
            </Field>
          )}
        </fieldset>

        <Field label="Observação (opcional)" htmlFor="balcao-obs">
          <Textarea
            id="balcao-obs"
            rows={2}
            maxLength={500}
            value={observacao}
            onChange={(event) => setObservacao(event.target.value)}
          />
        </Field>

        {erro && <Alert variant="danger">{erro}</Alert>}
      </div>
      <DialogFooter>
        <Button variant="secondary" onClick={onDone} disabled={criar.isPending}>
          Cancelar
        </Button>
        <Button loading={criar.isPending} onClick={() => void concluir()} disabled={!linhas.length}>
          <Plus />
          Concluir venda · {formatBRL(totais.totalCents)}
        </Button>
      </DialogFooter>
    </>
  );
}
