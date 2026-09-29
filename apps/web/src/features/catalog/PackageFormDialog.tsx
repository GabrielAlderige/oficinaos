import { formatBRL, parseQuantity, type PackageItem, type ServicePackage } from '@oficinaos/shared';
import { Package, Plus, Trash2, Wrench } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Alert } from '../../components/ui/display';
import { Field, fieldA11y } from '../../components/ui/field';
import { Input, Textarea } from '../../components/ui/input';
import { SearchInput } from '../../components/ui/list-parts';
import { ConfirmDialog, Dialog, DialogContent, DialogFooter, DialogHeader } from '../../components/ui/overlays';
import { cn } from '../../lib/cn';
import { errorMessage } from '../../lib/errors';
import { useDebouncedValue } from '../../lib/use-debounced-value';
import { useDeletePackage, useParts, useSavePackage, useServices } from './api';
import { formatQty } from './stock';

/** Uma linha sendo montada na tela: o preço é só para mostrar a conta. */
interface Linha {
  kind: 'SERVICE' | 'PART';
  refId: string;
  name: string;
  unit: string | null;
  unitPriceCents: number | null;
  /** o que a pessoa digitou; vira número na hora de salvar */
  quantity: string;
  unavailable: boolean;
}

const quantidadeBR = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3, useGrouping: false });

function toLinhas(itens: PackageItem[]): Linha[] {
  return itens.map((item) => ({
    kind: item.kind,
    refId: item.refId,
    name: item.name,
    unit: item.unit,
    unitPriceCents: item.unitPriceCents,
    quantity: quantidadeBR.format(item.quantity),
    unavailable: item.unavailable,
  }));
}

export function PackageFormDialog({
  open,
  onOpenChange,
  pacote,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  pacote?: ServicePackage;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <Corpo pacote={pacote} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function Corpo({ pacote, onDone }: { pacote?: ServicePackage; onDone(): void }) {
  const salvar = useSavePackage();
  const excluir = useDeletePackage();
  const [nome, setNome] = useState(pacote?.name ?? '');
  const [descricao, setDescricao] = useState(pacote?.description ?? '');
  const [ativo, setAtivo] = useState(pacote?.isActive ?? true);
  const [linhas, setLinhas] = useState<Linha[]>(() => toLinhas(pacote?.items ?? []));
  const [confirmando, setConfirmando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const total = linhas.reduce((soma, linha) => {
    const quantidade = parseQuantity(linha.quantity || 'x');
    if (linha.unavailable || linha.unitPriceCents === null || quantidade === null) return soma;
    return soma + Math.round((linha.unitPriceCents * quantidade) / 1000);
  }, 0);

  function adicionar(linha: Omit<Linha, 'quantity' | 'unavailable'>) {
    setLinhas((atuais) =>
      atuais.some((existente) => existente.kind === linha.kind && existente.refId === linha.refId)
        ? atuais
        : [...atuais, { ...linha, quantity: '1', unavailable: false }],
    );
  }

  async function submeter() {
    setErro(null);
    if (nome.trim().length < 2) {
      setErro('Dê um nome ao pacote.');
      return;
    }
    if (!linhas.length) {
      setErro('O pacote precisa de pelo menos um item.');
      return;
    }
    const items = [];
    for (const linha of linhas) {
      const milli = parseQuantity(linha.quantity || 'x');
      if (milli === null || milli <= 0) {
        setErro(`Quantidade inválida em “${linha.name}”.`);
        return;
      }
      items.push({
        serviceId: linha.kind === 'SERVICE' ? linha.refId : null,
        partId: linha.kind === 'PART' ? linha.refId : null,
        quantity: milli / 1000,
      });
    }

    try {
      await salvar.mutateAsync({
        id: pacote?.id,
        body: { name: nome.trim(), description: descricao.trim() || undefined, items, isActive: ativo },
      });
      toast.success(pacote ? 'Pacote atualizado.' : 'Pacote criado.');
      onDone();
    } catch (falha) {
      setErro(errorMessage(falha));
    }
  }

  return (
    <>
      <DialogHeader
        title={pacote ? 'Editar pacote' : 'Novo pacote'}
        description="Os serviços e as peças que entram juntos. O preço é o do catálogo no dia em que você usa."
      />

      <div className="space-y-4">
        {erro && <Alert variant="danger">{erro}</Alert>}

        <Field label="Nome do pacote" htmlFor="pacote-nome">
          <Input
            {...fieldA11y('pacote-nome')}
            autoFocus
            value={nome}
            onChange={(evento) => setNome(evento.target.value)}
            placeholder="Ex.: Revisão dos 10.000 km"
          />
        </Field>

        <Field label="Descrição" htmlFor="pacote-descricao" hint="Opcional. O que está incluído, em uma linha.">
          <Textarea
            {...fieldA11y('pacote-descricao', undefined, true)}
            rows={2}
            value={descricao}
            onChange={(evento) => setDescricao(evento.target.value)}
          />
        </Field>

        <div>
          <p className="mb-2 text-sm font-medium">O que entra no pacote</p>
          {linhas.length ? (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {linhas.map((linha, indice) => (
                <li key={`${linha.kind}-${linha.refId}`} className="flex items-center gap-3 px-3 py-2">
                  {linha.kind === 'SERVICE' ? (
                    <Wrench className="size-3.5 shrink-0 text-muted" aria-hidden="true" />
                  ) : (
                    <Package className="size-3.5 shrink-0 text-muted" aria-hidden="true" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{linha.name}</span>
                    <span className="block text-xs text-muted">
                      {linha.unavailable
                        ? 'Saiu do catálogo — não entra na conta'
                        : linha.unitPriceCents !== null
                          ? `${formatBRL(linha.unitPriceCents)} cada`
                          : 'Sem preço no catálogo'}
                    </span>
                  </span>
                  <Input
                    aria-label={`Quantidade de ${linha.name}`}
                    inputMode="decimal"
                    className="w-20 text-right"
                    value={linha.quantity}
                    onChange={(evento) =>
                      setLinhas((atuais) =>
                        atuais.map((atual, i) => (i === indice ? { ...atual, quantity: evento.target.value } : atual)),
                      )
                    }
                  />
                  <span className="w-8 shrink-0 text-xs text-muted">{linha.unit ?? ''}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Tirar ${linha.name} do pacote`}
                    onClick={() => setLinhas((atuais) => atuais.filter((_, i) => i !== indice))}
                  >
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-muted">
              Busque abaixo os serviços e as peças que este pacote leva.
            </p>
          )}
          {linhas.length > 0 && (
            <p className="mt-2 text-sm text-muted">
              Hoje o pacote sai por <span className="font-semibold tabular text-foreground">{formatBRL(total)}</span>. Na
              OS cada linha continua editável.
            </p>
          )}
        </div>

        <Busca onAdicionar={adicionar} />

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4"
            checked={ativo}
            onChange={(evento) => setAtivo(evento.target.checked)}
          />
          Pacote ativo (aparece na hora de montar a OS)
        </label>
      </div>

      <DialogFooter>
        {pacote && (
          <Button variant="ghost" className="sm:mr-auto" onClick={() => setConfirmando(true)}>
            <Trash2 />
            Excluir
          </Button>
        )}
        <Button variant="secondary" onClick={onDone}>
          Cancelar
        </Button>
        <Button loading={salvar.isPending} onClick={() => void submeter()}>
          {pacote ? 'Salvar pacote' : 'Criar pacote'}
        </Button>
      </DialogFooter>

      {pacote && (
        <ConfirmDialog
          open={confirmando}
          onOpenChange={setConfirmando}
          title={`Excluir “${pacote.name}”?`}
          description="As OS que já usaram o pacote continuam como estão — só ele some da lista."
          confirmLabel="Excluir pacote"
          destructive
          onConfirm={async () => {
            try {
              await excluir.mutateAsync(pacote.id);
              toast.success('Pacote excluído.');
              onDone();
            } catch (falha) {
              toast.error(errorMessage(falha));
            }
          }}
        />
      )}
    </>
  );
}

/** A busca que alimenta o pacote: serviço de um lado, peça do outro. */
function Busca({ onAdicionar }: { onAdicionar(linha: Omit<Linha, 'quantity' | 'unavailable'>): void }) {
  const [aba, setAba] = useState<'SERVICE' | 'PART'>('SERVICE');
  const [busca, setBusca] = useState('');
  const q = useDebouncedValue(busca.trim(), 250);
  const servicos = useServices({ q, status: 'active', page: 1, pageSize: 6 }, { enabled: aba === 'SERVICE' });
  const pecas = useParts({ q, attention: false, page: 1, pageSize: 6 }, { enabled: aba === 'PART' });
  const vazio = aba === 'SERVICE' ? !servicos.data?.data.length : !pecas.data?.data.length;

  return (
    <div className="rounded-lg border border-border p-3">
      <div role="tablist" aria-label="O que adicionar" className="mb-3 inline-flex rounded-lg border border-border p-0.5">
        {(
          [
            { chave: 'SERVICE', rotulo: 'Serviços' },
            { chave: 'PART', rotulo: 'Peças' },
          ] as const
        ).map((opcao) => (
          <button
            key={opcao.chave}
            type="button"
            role="tab"
            aria-selected={aba === opcao.chave}
            onClick={() => setAba(opcao.chave)}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm transition-colors',
              aba === opcao.chave ? 'bg-surface-muted font-medium text-foreground' : 'text-muted hover:text-foreground',
            )}
          >
            {opcao.rotulo}
          </button>
        ))}
      </div>

      <SearchInput
        value={busca}
        onChange={setBusca}
        label={aba === 'SERVICE' ? 'Buscar serviços para o pacote' : 'Buscar peças para o pacote'}
        placeholder={aba === 'SERVICE' ? 'Nome ou categoria do serviço' : 'Nome, código ou marca da peça'}
      />

      <ul className="mt-2 max-h-48 divide-y divide-border overflow-y-auto">
        {aba === 'SERVICE' &&
          (servicos.data?.data ?? []).map((servico) => (
            <li key={servico.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 px-2 py-2 text-left hover:bg-surface-muted"
                onClick={() =>
                  onAdicionar({
                    kind: 'SERVICE',
                    refId: servico.id,
                    name: servico.name,
                    unit: null,
                    unitPriceCents: servico.effectivePriceCents,
                  })
                }
              >
                <span className="min-w-0 flex-1 truncate text-sm">{servico.name}</span>
                <span className="flex shrink-0 items-center gap-2 text-sm text-muted tabular">
                  {servico.effectivePriceCents !== null ? formatBRL(servico.effectivePriceCents) : 'Sem hora técnica'}
                  <Plus className="size-4" aria-hidden="true" />
                </span>
              </button>
            </li>
          ))}

        {aba === 'PART' &&
          (pecas.data?.data ?? []).map((peca) => (
            <li key={peca.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 px-2 py-2 text-left hover:bg-surface-muted"
                onClick={() =>
                  onAdicionar({
                    kind: 'PART',
                    refId: peca.id,
                    name: peca.name,
                    unit: peca.unit,
                    unitPriceCents: peca.salePriceCents,
                  })
                }
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{peca.name}</span>
                  <span className="block truncate text-xs text-muted">
                    {formatQty(peca.quantityAvailable, peca.unit)} em estoque
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2 text-sm text-muted tabular">
                  {peca.salePriceCents !== null ? formatBRL(peca.salePriceCents) : 'Sem preço'}
                  <Plus className="size-4" aria-hidden="true" />
                </span>
              </button>
            </li>
          ))}

        {vazio && (
          <li className="px-2 py-3 text-center text-sm text-muted">
            {q ? `Nada encontrado para “${q}”.` : 'Nada cadastrado ainda.'}
          </li>
        )}
      </ul>
    </div>
  );
}
