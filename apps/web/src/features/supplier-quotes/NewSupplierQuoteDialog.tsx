import {
  DEFAULT_SUPPLIER_QUOTE_HOURS,
  formatQuantity,
  MAX_SUPPLIERS_PER_QUOTE,
  type CreatedSupplierQuote,
  type Part,
  type SupplierListItem,
  type WorkOrder,
} from '@oficinaos/shared';
import { useQueries } from '@tanstack/react-query';
import { ArrowRight, Star } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Button } from '../../components/ui/button';
import { Alert, Badge, Skeleton } from '../../components/ui/display';
import { Field, Select } from '../../components/ui/field';
import { Textarea } from '../../components/ui/input';
import { SearchInput } from '../../components/ui/list-parts';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '../../components/ui/overlays';
import { api } from '../../lib/api-client';
import { errorMessage } from '../../lib/errors';
import { useCan } from '../../lib/session';
import { useDebouncedValue } from '../../lib/use-debounced-value';
import { catalogKeys } from '../catalog/api';
import { useSuppliers } from '../suppliers/api';
import { useCreateSupplierQuote } from './api';
import { SupplierLinks } from './SupplierLinks';

const PRAZOS = [
  { horas: 24, rotulo: '24 horas' },
  { horas: DEFAULT_SUPPLIER_QUOTE_HOURS, rotulo: '48 horas' },
  { horas: 72, rotulo: '3 dias' },
  { horas: 168, rotulo: '7 dias' },
];

const semAcento = (texto: string) =>
  texto
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim();

/**
 * Pedir preço de peças a vários fornecedores de uma vez. A tela manda só os ids:
 * o que o fornecedor vê (peça, código, quantidade, carro sem placa) a API monta.
 */
export function NewSupplierQuoteDialog({ order, open, onOpenChange }: {
  order: WorkOrder;
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        {open && <Corpo order={order} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function Corpo({ order, onDone }: { order: WorkOrder; onDone(): void }) {
  const [criada, setCriada] = useState<CreatedSupplierQuote | null>(null);
  if (criada) return <LinksGerados order={order} criada={criada} onDone={onDone} />;
  return <Formulario order={order} onCreated={setCriada} onCancel={onDone} />;
}

function Formulario({ order, onCreated, onCancel }: {
  order: WorkOrder;
  onCreated(criada: CreatedSupplierQuote): void;
  onCancel(): void;
}) {
  const podeCadastrar = useCan('suppliers:write');
  const create = useCreateSupplierQuote();
  const pecas = order.items.filter((item) => item.type === 'PART');
  // o que ainda não foi ao cliente é o que normalmente falta cotar
  const rascunhos = pecas.filter((item) => item.approvalStatus === 'DRAFT');
  const [itens, setItens] = useState<ReadonlySet<string>>(
    () => new Set((rascunhos.length ? rascunhos : pecas).map((item) => item.id)),
  );
  const [marcados, setMarcados] = useState<ReadonlyMap<string, string>>(new Map());
  const [mexeuNosFornecedores, setMexeu] = useState(false);
  const [busca, setBusca] = useState('');
  const [prazo, setPrazo] = useState(DEFAULT_SUPPLIER_QUOTE_HOURS);
  const [incluirChassi, setIncluirChassi] = useState(false);
  const [mensagem, setMensagem] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  const termo = useDebouncedValue(busca.trim());
  const fornecedores = useSuppliers({ q: termo, page: 1, pageSize: 100 });

  // a peça diz de quem a oficina costuma comprar e de que categoria ela é
  const idsDasPecas = [...new Set(pecas.filter((item) => itens.has(item.id)).flatMap((item) => (item.partId ? [item.partId] : [])))];
  const detalhes = useQueries({
    queries: idsDasPecas.map((id) => ({ queryKey: catalogKeys.part(id), queryFn: () => api<Part>(`/parts/${id}`) })),
  });
  const pecasCarregadas = detalhes.flatMap((consulta) => (consulta.data ? [consulta.data] : []));
  const preferidos = new Map(
    pecasCarregadas.flatMap((peca) => (peca.preferredSupplier ? [[peca.preferredSupplier.id, peca.preferredSupplier.name] as const] : [])),
  );
  const categorias = new Set(pecasCarregadas.flatMap((peca) => (peca.category ? [semAcento(peca.category.name)] : [])));

  // os preferidos das peças já vêm marcados, até a pessoa mexer na lista
  const escolhidos = mexeuNosFornecedores ? marcados : new Map([...preferidos].slice(0, MAX_SUPPLIERS_PER_QUOTE));

  const sugestao = (fornecedor: SupplierListItem) => {
    if (preferidos.has(fornecedor.id)) return 'Preferido da peça';
    const categoria = fornecedor.categories.find((c) => categorias.has(semAcento(c)));
    return categoria ? `Vende ${categoria}` : null;
  };
  const lista = [...(fornecedores.data?.data ?? [])].sort(
    (a, b) => Number(Boolean(sugestao(b))) - Number(Boolean(sugestao(a))) || a.name.localeCompare(b.name, 'pt-BR'),
  );
  const noLimite = escolhidos.size >= MAX_SUPPLIERS_PER_QUOTE;

  function alternarItem(id: string) {
    setItens((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(id)) proximo.delete(id);
      else proximo.add(id);
      return proximo;
    });
  }

  function alternarFornecedor(fornecedor: SupplierListItem) {
    setMexeu(true);
    setMarcados(() => {
      const proximo = new Map(escolhidos);
      if (proximo.has(fornecedor.id)) proximo.delete(fornecedor.id);
      else if (proximo.size < MAX_SUPPLIERS_PER_QUOTE) proximo.set(fornecedor.id, fornecedor.name);
      return proximo;
    });
  }

  async function gerar() {
    setErro(null);
    try {
      const criada = await create.mutateAsync({
        workOrderId: order.id,
        // na ordem da OS, não na ordem dos cliques
        workOrderItemIds: pecas.filter((item) => itens.has(item.id)).map((item) => item.id),
        supplierIds: [...escolhidos.keys()],
        includeVin: incluirChassi,
        message: mensagem,
        expiresInHours: prazo,
      });
      onCreated(criada);
    } catch (err) {
      setErro(errorMessage(err));
    }
  }

  const semFornecedorCadastrado = !termo && fornecedores.data?.meta.total === 0;

  return (
    <>
      <DialogHeader
        title="Cotar peças com fornecedores"
        description="Cada fornecedor recebe um link próprio e responde pelo celular. Ele vê as peças e o carro, nunca a placa nem o cliente."
      />
      <div className="space-y-5">
        {erro && <Alert variant="danger">{erro}</Alert>}

        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-medium">Peças</legend>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {pecas.map((item) => (
              <li key={item.id}>
                <label className="flex cursor-pointer items-start gap-3 px-3 py-2.5 text-sm">
                  <input type="checkbox" className="mt-0.5 size-4" checked={itens.has(item.id)} onChange={() => alternarItem(item.id)} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{item.description}</span>
                    <span className="block truncate text-xs text-muted">
                      {[item.partCode, item.brand, item.approvalStatus !== 'DRAFT' && 'já foi no orçamento'].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className="shrink-0 text-muted tabular">qtd. {formatQuantity(Math.round(item.quantity * 1000))}</span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="mb-2 flex w-full items-center justify-between gap-3 text-sm font-medium">
            Fornecedores
            <span className="text-xs font-normal text-muted tabular">
              {escolhidos.size} de até {MAX_SUPPLIERS_PER_QUOTE}
            </span>
          </legend>
          {semFornecedorCadastrado ? (
            <Alert variant="warning">
              Nenhum fornecedor cadastrado ainda.{' '}
              {podeCadastrar && (
                <Link to="/fornecedores" className="font-medium underline">
                  Cadastrar fornecedores
                </Link>
              )}
            </Alert>
          ) : (
            <>
              <SearchInput value={busca} onChange={setBusca} placeholder="Buscar fornecedor" label="Buscar fornecedor" />
              {fornecedores.isPending ? (
                <Skeleton className="h-24 w-full" />
              ) : lista.length === 0 ? (
                <p className="px-1 py-3 text-sm text-muted">Nenhum fornecedor encontrado.</p>
              ) : (
                <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-lg border border-border">
                  {lista.map((fornecedor) => {
                    const marcado = escolhidos.has(fornecedor.id);
                    const motivo = sugestao(fornecedor);
                    return (
                      <li key={fornecedor.id}>
                        <label className="flex cursor-pointer items-start gap-3 px-3 py-2.5 text-sm has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
                          <input
                            type="checkbox"
                            className="mt-0.5 size-4"
                            checked={marcado}
                            disabled={!marcado && noLimite}
                            onChange={() => alternarFornecedor(fornecedor)}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="truncate font-medium">{fornecedor.name}</span>
                              {motivo && (
                                <Badge tone="accent">
                                  {preferidos.has(fornecedor.id) && <Star className="size-3" aria-hidden="true" />}
                                  {motivo}
                                </Badge>
                              )}
                            </span>
                            <span className="block truncate text-xs text-muted">
                              {fornecedor.whatsapp ? fornecedor.contactName ?? 'WhatsApp cadastrado' : 'Sem WhatsApp: você copia a mensagem'}
                            </span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Prazo para responder" htmlFor="rfq-prazo" hint="Depois disso o link para de aceitar resposta.">
            <Select id="rfq-prazo" value={prazo} onChange={(event) => setPrazo(Number(event.target.value))}>
              {PRAZOS.map((opcao) => (
                <option key={opcao.horas} value={opcao.horas}>
                  {opcao.rotulo}
                </option>
              ))}
            </Select>
          </Field>
          <label className="flex items-start gap-2.5 self-center text-sm">
            <input type="checkbox" className="mt-0.5 size-4" checked={incluirChassi} onChange={(event) => setIncluirChassi(event.target.checked)} />
            <span>
              Mandar o chassi
              <span className="block text-xs text-muted">Ajuda em câmbio e injeção. A placa nunca vai.</span>
            </span>
          </label>
        </div>

        <Field label="Recado para os fornecedores" htmlFor="rfq-mensagem" hint="Aparece no topo da página de cada um.">
          <Textarea
            id="rfq-mensagem"
            rows={2}
            maxLength={500}
            value={mensagem}
            onChange={(event) => setMensagem(event.target.value)}
            placeholder="Ex.: preciso da original ou de primeira linha; carro parado na oficina."
          />
        </Field>
      </div>
      <DialogFooter>
        <Button variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
        <Button disabled={itens.size === 0 || escolhidos.size === 0} loading={create.isPending} onClick={() => void gerar()}>
          Gerar links
        </Button>
      </DialogFooter>
    </>
  );
}

function LinksGerados({ order, criada, onDone }: { order: WorkOrder; criada: CreatedSupplierQuote; onDone(): void }) {
  return (
    <>
      <DialogHeader
        title={`Cotação nº ${criada.quote.number} criada`}
        description="Mande cada link para o seu fornecedor. As respostas aparecem no quadro da cotação."
      />
      <div className="space-y-4">
        <Alert variant="warning">
          Os links aparecem só agora: o sistema guarda apenas uma impressão digital deles. Se perder um, gere outro no quadro
          — o anterior deixa de funcionar.
        </Alert>
        <SupplierLinks links={criada.links} />
      </div>
      <DialogFooter>
        <Button variant="secondary" onClick={onDone}>
          Fechar
        </Button>
        <Button asChild>
          <Link to={`/ordens/${order.number}/cotacoes/${criada.quote.id}`} onClick={onDone}>
            Ver quadro da cotação
            <ArrowRight />
          </Link>
        </Button>
      </DialogFooter>
    </>
  );
}
