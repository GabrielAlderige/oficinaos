import {
  formatBRL,
  formatBRLInput,
  formatQuantity,
  lineValueCents,
  parseBRL,
  parseQuantity,
  type Part,
  type PurchaseOrder,
  type WorkOrder,
  type WorkOrderPurchaseLine,
} from '@oficinaos/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Package, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { usePageCrumb } from '../../app/layouts/crumbs';
import { Button } from '../../components/ui/button';
import { Alert, Card, CardHeader, PageHeader, Skeleton } from '../../components/ui/display';
import { Field, fieldA11y, Select } from '../../components/ui/field';
import { AdornedInput, Input, Textarea } from '../../components/ui/input';
import { SearchInput } from '../../components/ui/list-parts';
import { Dialog, DialogContent, DialogHeader } from '../../components/ui/overlays';
import { api, ApiError } from '../../lib/api-client';
import { errorMessage } from '../../lib/errors';
import { useDebouncedValue } from '../../lib/use-debounced-value';
import { catalogKeys, useParts } from '../catalog/api';
import { useSuppliers } from '../suppliers/api';
import { useWorkOrder } from '../work-orders/api';
import { useCreatePurchaseOrder, usePurchaseOrder, useUpdatePurchaseOrder, useWorkOrderPurchases } from './api';

interface Linha {
  chave: string;
  partId: string;
  nome: string;
  codigo: string | null;
  unidade: string;
  workOrderItemId: string | null;
  paraOs: string | null;
  quantidade: string;
  custo: string;
}

interface Inicial {
  supplierId: string;
  expectedOn: string;
  frete: string;
  notas: string;
  linhas: Linha[];
}

let sequencia = 0;
const novaChave = () => `linha-${++sequencia}`;

/** A mensagem de cada linha recusada, em vez de um "confira os campos" genérico. */
function motivoDoErro(err: unknown, linhas: readonly Linha[]): string {
  if (err instanceof ApiError && err.problem?.errors?.length) {
    return err.problem.errors
      .map(({ path, message }) => {
        const indice = /items\.(\d+)/.exec(path)?.[1];
        const linha = indice === undefined ? undefined : linhas[Number(indice)];
        return linha ? `${linha.nome}: ${message}` : message;
      })
      .join(' · ');
  }
  return errorMessage(err);
}

/** Novo pedido (`/compras/novo`, ou `?os=12` com as peças "Comprar" da OS) e edição do rascunho. */
export function PurchaseOrderFormPage() {
  const { id } = useParams();
  return id ? <EditarRascunho id={id} /> : <NovoPedido />;
}

function NovoPedido() {
  const [params] = useSearchParams();
  const numeroOs = Number(params.get('os'));
  const daOs = Number.isFinite(numeroOs) && numeroOs > 0;
  const os = useWorkOrder(daOs ? numeroOs : 0);
  const compras = useWorkOrderPurchases(os.data?.id ?? '', Boolean(os.data));
  usePageCrumb('Novo pedido');

  if (daOs && (os.isPending || compras.isPending)) return <Carregando />;
  if (daOs && (os.isError || compras.isError)) return <Alert variant="danger">{errorMessage(os.error ?? compras.error)}</Alert>;

  const inicial: Inicial = {
    supplierId: '',
    expectedOn: '',
    frete: '',
    notas: '',
    linhas: daOs && os.data ? pecasParaComprar(os.data, compras.data ?? []) : [],
  };
  return <Formulario inicial={inicial} os={daOs ? (os.data ?? null) : null} />;
}

/** As peças "Comprar" da OS que ainda não estão num pedido vivo. */
function pecasParaComprar(os: WorkOrder, compras: readonly WorkOrderPurchaseLine[]): Linha[] {
  const jaPedidas = new Set(compras.filter((c) => c.status !== 'CANCELED').map((c) => c.workOrderItemId));
  return os.items
    .filter((item) => item.type === 'PART' && item.partId && item.sourcing === 'TO_ORDER' && item.stockStatus !== 'CONSUMED' && !jaPedidas.has(item.id))
    .map((item) => ({
      chave: novaChave(),
      partId: item.partId!,
      nome: item.description,
      codigo: item.partCode,
      unidade: 'un',
      workOrderItemId: item.id,
      paraOs: `OS ${os.number}`,
      quantidade: formatQuantity(Math.round(item.quantity * 1000)),
      custo: item.unitCostCents ? formatBRLInput(item.unitCostCents) : '',
    }));
}

function EditarRascunho({ id }: { id: string }) {
  const pedido = usePurchaseOrder(id);
  usePageCrumb(pedido.data ? `Pedido nº ${pedido.data.number}` : undefined, `/compras/${id}`);
  if (pedido.isPending) return <Carregando />;
  if (pedido.isError) return <Alert variant="danger">{errorMessage(pedido.error)}</Alert>;
  if (pedido.data.status !== 'DRAFT') {
    return (
      <Alert variant="warning">
        Este pedido já foi feito ao fornecedor e não muda mais.{' '}
        <Link to={`/compras/${id}`} className="font-medium underline">
          Voltar para o pedido
        </Link>
      </Alert>
    );
  }
  return <Formulario inicial={deRascunho(pedido.data)} pedido={pedido.data} os={null} />;
}

function deRascunho(pedido: PurchaseOrder): Inicial {
  return {
    supplierId: pedido.supplier.id,
    expectedOn: pedido.expectedOn ?? '',
    frete: pedido.shippingCents ? formatBRLInput(pedido.shippingCents) : '',
    notas: pedido.notes ?? '',
    linhas: pedido.items.map((item) => ({
      chave: novaChave(),
      partId: item.partId,
      nome: item.description,
      codigo: item.partCode,
      unidade: item.unit.toLowerCase(),
      workOrderItemId: item.workOrder?.itemId ?? null,
      paraOs: item.workOrder ? `OS ${item.workOrder.number}` : null,
      quantidade: formatQuantity(Math.round(item.quantity * 1000)),
      custo: formatBRLInput(item.unitCostCents),
    })),
  };
}

function Carregando() {
  return (
    <div className="space-y-4" aria-label="Carregando pedido">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-56 w-full" />
    </div>
  );
}

function Formulario({ inicial, pedido, os }: { inicial: Inicial; pedido?: PurchaseOrder; os: WorkOrder | null }) {
  const navigate = useNavigate();
  const create = useCreatePurchaseOrder();
  const update = useUpdatePurchaseOrder(pedido?.id ?? '');
  const fornecedores = useSuppliers({ q: '', page: 1, pageSize: 100 });
  const [supplierId, setSupplierId] = useState(inicial.supplierId);
  const [expectedOn, setExpectedOn] = useState(inicial.expectedOn);
  const [frete, setFrete] = useState(inicial.frete);
  const [notas, setNotas] = useState(inicial.notas);
  const [linhas, setLinhas] = useState<Linha[]>(inicial.linhas);
  const [escolhendo, setEscolhendo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [tentou, setTentou] = useState(false);

  const mudar = (chave: string, parte: Partial<Linha>) => setLinhas((atual) => atual.map((l) => (l.chave === chave ? { ...l, ...parte } : l)));

  const conta = linhas.map((linha) => {
    const milli = parseQuantity(linha.quantidade || 'x');
    const custo = parseBRL(linha.custo || 'x');
    return { linha, milli: milli && milli > 0 ? milli : null, custo };
  });
  const freteCents = frete.trim() ? parseBRL(frete) : 0;
  const itensCents = conta.reduce((soma, c) => soma + (c.milli && c.custo !== null ? lineValueCents(c.milli, c.custo) : 0), 0);
  const invalido = !supplierId || !linhas.length || conta.some((c) => c.milli === null || c.custo === null) || freteCents === null;

  async function salvar() {
    setTentou(true);
    setErro(null);
    if (invalido) return;
    const corpo = {
      supplierId,
      expectedOn: expectedOn || null,
      shippingCents: freteCents ?? 0,
      notes: notas,
      items: conta.map(({ linha, milli, custo }) => ({
        partId: linha.partId,
        quantity: milli! / 1000,
        unitCostCents: custo!,
        workOrderItemId: linha.workOrderItemId,
      })),
    };
    try {
      const salvo = pedido ? await update.mutateAsync({ ...corpo, version: pedido.version }) : await create.mutateAsync(corpo);
      navigate(`/compras/${salvo.id}`);
    } catch (err) {
      setErro(motivoDoErro(err, linhas));
    }
  }

  const ativos = fornecedores.data?.data ?? [];
  const titulo = pedido ? `Editar pedido nº ${pedido.number}` : os ? `Pedir peças da OS ${os.number}` : 'Novo pedido de compra';

  return (
    <>
      <PageHeader
        title={titulo}
        description={
          pedido
            ? 'O rascunho ainda pode mudar. Depois de marcado como pedido ao fornecedor, as peças congelam.'
            : 'Monte o pedido em rascunho; na próxima tela você marca como feito e manda ao fornecedor pelo WhatsApp.'
        }
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card>
          <CardHeader
            title="Peças"
            description={os ? 'As peças marcadas como "Comprar" na OS que ainda não estão em nenhum pedido.' : undefined}
            action={
              <Button size="sm" variant="secondary" onClick={() => setEscolhendo(true)}>
                <Plus />
                Adicionar peça
              </Button>
            }
          />
          {linhas.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted">
              {os ? 'Nenhuma peça desta OS está esperando compra.' : 'Nenhuma peça ainda. Adicione do catálogo.'}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {conta.map(({ linha, milli, custo }) => (
                <li key={linha.chave} className="grid gap-3 px-5 py-3 sm:grid-cols-[minmax(0,1fr)_6rem_8rem_6rem_2rem] sm:items-center">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{linha.nome}</span>
                    <span className="block truncate text-xs text-muted">{[linha.codigo, linha.paraOs && `para a ${linha.paraOs}`].filter(Boolean).join(' · ')}</span>
                  </span>
                  <Field label="Quantidade" htmlFor={`q-${linha.chave}`} error={tentou && milli === null ? 'Inválida' : undefined}>
                    <Input
                      {...fieldA11y(`q-${linha.chave}`, tentou && milli === null ? 'Inválida' : undefined)}
                      inputMode="decimal"
                      value={linha.quantidade}
                      onChange={(event) => mudar(linha.chave, { quantidade: event.target.value })}
                    />
                  </Field>
                  <Field label="Custo unitário" htmlFor={`c-${linha.chave}`} error={tentou && custo === null ? 'Informe o custo' : undefined}>
                    <AdornedInput
                      leading="R$"
                      {...fieldA11y(`c-${linha.chave}`, tentou && custo === null ? 'Informe o custo' : undefined)}
                      inputMode="decimal"
                      value={linha.custo}
                      placeholder="0,00"
                      onChange={(event) => mudar(linha.chave, { custo: event.target.value })}
                    />
                  </Field>
                  <span className="text-sm font-medium tabular sm:text-right">{milli && custo !== null ? formatBRL(lineValueCents(milli, custo)) : '–'}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    aria-label={`Tirar ${linha.nome} do pedido`}
                    onClick={() => setLinhas((atual) => atual.filter((l) => l.chave !== linha.chave))}
                  >
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Pedido" />
            <div className="space-y-4 px-5 py-4">
              {erro && <Alert variant="danger">{erro}</Alert>}
              <Field label="Fornecedor" htmlFor="po-supplier" error={tentou && !supplierId ? 'Escolha o fornecedor' : undefined}>
                <Select id="po-supplier" value={supplierId} onChange={(event) => setSupplierId(event.target.value)}>
                  <option value="">Escolha…</option>
                  {ativos.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Previsão de entrega" htmlFor="po-expected" hint="Opcional; dá para informar ao marcar como pedido.">
                <Input id="po-expected" type="date" value={expectedOn} onChange={(event) => setExpectedOn(event.target.value)} />
              </Field>
              <Field label="Frete combinado" htmlFor="po-shipping" error={freteCents === null ? 'Valor inválido' : undefined}>
                <AdornedInput
                  leading="R$"
                  {...fieldA11y('po-shipping', freteCents === null ? 'Valor inválido' : undefined)}
                  inputMode="decimal"
                  value={frete}
                  placeholder="0,00"
                  onChange={(event) => setFrete(event.target.value)}
                />
              </Field>
              <Field label="Observações" htmlFor="po-notes">
                <Textarea id="po-notes" rows={2} value={notas} onChange={(event) => setNotas(event.target.value)} />
              </Field>
              <div className="space-y-1 border-t border-border pt-3 text-sm">
                <p className="flex justify-between">
                  <span className="text-muted">Peças</span>
                  <span className="tabular">{formatBRL(itensCents)}</span>
                </p>
                <p className="flex justify-between">
                  <span className="text-muted">Frete</span>
                  <span className="tabular">{formatBRL(freteCents ?? 0)}</span>
                </p>
                <p className="flex justify-between text-base font-semibold">
                  <span>Total</span>
                  <span className="tabular">{formatBRL(itensCents + (freteCents ?? 0))}</span>
                </p>
              </div>
              {tentou && !linhas.length && <p className="text-sm text-danger">Adicione pelo menos uma peça.</p>}
              <div className="flex flex-col gap-2">
                <Button loading={create.isPending || update.isPending} onClick={() => void salvar()}>
                  {pedido ? 'Salvar rascunho' : 'Criar rascunho'}
                </Button>
                <Button variant="secondary" onClick={() => navigate(pedido ? `/compras/${pedido.id}` : '/compras')}>
                  Cancelar
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </div>

      <EscolherPeca
        open={escolhendo}
        onOpenChange={setEscolhendo}
        onPick={(linha) => setLinhas((atual) => [...atual, linha])}
      />
    </>
  );
}

/** Busca no catálogo; o custo sugerido é o último pago (ou o médio). */
function EscolherPeca({ open, onOpenChange, onPick }: { open: boolean; onOpenChange(open: boolean): void; onPick(linha: Linha): void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader title="Adicionar peça" description="Só peça cadastrada entra no pedido: é ela que tem estoque e custo." />
        {open && <BuscaDePeca onPick={(linha) => { onPick(linha); onOpenChange(false); }} />}
      </DialogContent>
    </Dialog>
  );
}

function BuscaDePeca({ onPick }: { onPick(linha: Linha): void }) {
  const queryClient = useQueryClient();
  const [busca, setBusca] = useState('');
  const q = useDebouncedValue(busca.trim(), 250);
  const pecas = useParts({ q, attention: false, page: 1, pageSize: 8 });
  const [abrindo, setAbrindo] = useState<string | null>(null);

  async function escolher(id: string) {
    setAbrindo(id);
    try {
      const peca = await queryClient.fetchQuery({ queryKey: catalogKeys.part(id), queryFn: () => api<Part>(`/parts/${id}`) });
      const custo = peca.lastCostCents ?? peca.averageCostCents;
      onPick({
        chave: novaChave(),
        partId: peca.id,
        nome: peca.name,
        codigo: peca.manufacturerCode,
        unidade: peca.unit.toLowerCase(),
        workOrderItemId: null,
        paraOs: null,
        quantidade: '1',
        custo: custo ? formatBRLInput(custo) : '',
      });
    } finally {
      setAbrindo(null);
    }
  }

  return (
    <div className="space-y-3">
      <SearchInput value={busca} onChange={setBusca} placeholder="Nome, código ou aplicação" label="Buscar peça" autoFocus />
      {pecas.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : !pecas.data?.data.length ? (
        <p className="py-4 text-center text-sm text-muted">Nenhuma peça encontrada.</p>
      ) : (
        <ul className="max-h-80 divide-y divide-border overflow-y-auto rounded-lg border border-border">
          {pecas.data.data.map((peca) => (
            <li key={peca.id}>
              <button
                type="button"
                disabled={abrindo !== null}
                onClick={() => void escolher(peca.id)}
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-surface-muted/60 disabled:opacity-60"
              >
                <Package className="size-4 shrink-0 text-muted" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{peca.name}</span>
                  <span className="block truncate text-xs text-muted">
                    {[peca.manufacturerCode, `em estoque: ${formatQuantity(Math.round(peca.quantityOnHand * 1000))}`].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
