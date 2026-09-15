import { formatBRL, formatBRLInput, formatQuantity, lineValueCents, parseBRL, parseQuantity, type PurchaseSuggestions } from '@oficinaos/shared';
import { Lightbulb } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Alert, Badge, Card, CardHeader, PageHeader, Skeleton } from '../../components/ui/display';
import { Field, Select } from '../../components/ui/field';
import { AdornedInput, Input } from '../../components/ui/input';
import { EmptyState } from '../../components/ui/list-parts';
import { ApiError } from '../../lib/api-client';
import { errorMessage } from '../../lib/errors';
import { useCan } from '../../lib/session';
import { useSuppliers } from '../suppliers/api';
import { useCreatePurchaseOrder, usePurchaseSuggestions } from './api';

type Grupo = PurchaseSuggestions['groups'][number];

/**
 * Sugestão de compra: o que repor do estoque mínimo e o que as OS esperam,
 * já agrupado pelo fornecedor preferido de cada peça. Nada é comprado aqui —
 * cada grupo vira um rascunho que a pessoa confere antes de pedir.
 */
export function PurchaseSuggestionsPage() {
  const sugestoes = usePurchaseSuggestions();
  const podeComprar = useCan('purchases:write');

  return (
    <>
      <PageHeader
        title="Sugestão de compra"
        description="Peças abaixo do estoque mínimo (descontando o que já está pedido) e peças que as OS em andamento esperam sem pedido."
      />
      {sugestoes.isPending ? (
        <Skeleton className="h-56 w-full" />
      ) : sugestoes.isError ? (
        <Alert variant="danger">{errorMessage(sugestoes.error)}</Alert>
      ) : !sugestoes.data.groups.length ? (
        <Card>
          <EmptyState
            icon={Lightbulb}
            title="Nada para comprar agora"
            description="Nenhuma peça está abaixo do mínimo e nenhuma OS espera peça sem pedido. Defina o estoque mínimo na ficha da peça para ela aparecer aqui."
          />
        </Card>
      ) : (
        <div className="space-y-6">
          {sugestoes.data.groups.map((grupo) => (
            <GrupoCard key={grupo.supplier?.id ?? 'sem-fornecedor'} grupo={grupo} podeComprar={podeComprar} />
          ))}
        </div>
      )}
    </>
  );
}

function GrupoCard({ grupo, podeComprar }: { grupo: Grupo; podeComprar: boolean }) {
  const navigate = useNavigate();
  const create = useCreatePurchaseOrder();
  const fornecedores = useSuppliers({ q: '', page: 1, pageSize: 100 }, { enabled: !grupo.supplier && podeComprar });
  const chaveDe = (item: Grupo['items'][number]) => item.workOrderItemId ?? `estoque-${item.partId}`;
  const [supplierId, setSupplierId] = useState(grupo.supplier?.id ?? '');
  const [linhas, setLinhas] = useState(() =>
    Object.fromEntries(
      grupo.items.map((item) => [
        chaveDe(item),
        {
          marcada: true,
          quantidade: formatQuantity(Math.round(item.quantity * 1000)),
          custo: item.unitCostCents !== null ? formatBRLInput(item.unitCostCents) : '',
        },
      ]),
    ),
  );
  const [erro, setErro] = useState<string | null>(null);

  const conta = grupo.items.map((item) => {
    const v = linhas[chaveDe(item)]!;
    const milli = parseQuantity(v.quantidade || 'x');
    const custo = parseBRL(v.custo || 'x');
    return { item, v, milli: milli && milli > 0 ? milli : null, custo };
  });
  const marcadas = conta.filter((c) => c.v.marcada);
  const total = marcadas.reduce((soma, c) => soma + (c.milli && c.custo !== null ? lineValueCents(c.milli, c.custo) : 0), 0);
  const invalido = !supplierId || !marcadas.length || marcadas.some((c) => c.milli === null || c.custo === null);

  async function criar() {
    setErro(null);
    try {
      const pedido = await create.mutateAsync({
        supplierId,
        expectedOn: null,
        shippingCents: 0,
        notes: '',
        items: marcadas.map((c) => ({
          partId: c.item.partId,
          quantity: c.milli! / 1000,
          unitCostCents: c.custo!,
          workOrderItemId: c.item.workOrderItemId,
        })),
      });
      toast.success(`Rascunho do pedido nº ${pedido.number} criado.`);
      navigate(`/compras/${pedido.id}`);
    } catch (err) {
      setErro(err instanceof ApiError && err.problem?.errors?.length ? err.problem.errors.map((e) => e.message).join(' · ') : errorMessage(err));
    }
  }

  const mudar = (chave: string, parte: Partial<(typeof linhas)[string]>) =>
    setLinhas((atual) => ({ ...atual, [chave]: { ...atual[chave]!, ...parte } }));

  return (
    <Card>
      <CardHeader
        title={grupo.supplier ? grupo.supplier.name : 'Sem fornecedor preferido'}
        description={`${grupo.items.length} ${grupo.items.length === 1 ? 'peça' : 'peças'}${grupo.supplier ? '' : ' — escolha de quem comprar'}`}
      />
      <ul className="divide-y divide-border">
        {conta.map(({ item, v, milli, custo }) => {
          const chave = chaveDe(item);
          return (
            <li key={chave} className="grid gap-3 px-5 py-3 sm:grid-cols-[auto_minmax(0,1fr)_6rem_8rem] sm:items-center">
              <input
                type="checkbox"
                className="size-4"
                checked={v.marcada}
                disabled={!podeComprar}
                onChange={(event) => mudar(chave, { marcada: event.target.checked })}
                aria-label={`Incluir ${item.partName}`}
              />
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2">
                  <Link to={`/pecas/${item.partId}`} className="truncate text-sm font-medium hover:underline">
                    {item.partName}
                  </Link>
                  <Badge tone={item.kind === 'WORK_ORDER' ? 'info' : 'warning'}>{item.kind === 'WORK_ORDER' ? `OS ${item.workOrderNumber}` : 'Estoque'}</Badge>
                </span>
                <span className="block text-xs text-muted">{[item.partCode, item.reason].filter(Boolean).join(' · ')}</span>
              </span>
              <Field label="Quantidade" htmlFor={`s-q-${chave}`} error={v.marcada && milli === null ? 'Inválida' : undefined}>
                <Input id={`s-q-${chave}`} inputMode="decimal" value={v.quantidade} disabled={!podeComprar} onChange={(event) => mudar(chave, { quantidade: event.target.value })} />
              </Field>
              <Field label="Custo unitário" htmlFor={`s-c-${chave}`} error={v.marcada && custo === null ? 'Informe' : undefined}>
                <AdornedInput
                  id={`s-c-${chave}`}
                  leading="R$"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={v.custo}
                  disabled={!podeComprar}
                  onChange={(event) => mudar(chave, { custo: event.target.value })}
                />
              </Field>
            </li>
          );
        })}
      </ul>
      {podeComprar && (
        <div className="flex flex-wrap items-end justify-between gap-3 border-t border-border px-5 py-3">
          {!grupo.supplier ? (
            <Field label="Fornecedor" htmlFor={`s-f-${grupo.items[0]?.partId}`} className="w-full sm:w-72">
              <Select id={`s-f-${grupo.items[0]?.partId}`} value={supplierId} onChange={(event) => setSupplierId(event.target.value)}>
                <option value="">Escolha…</option>
                {(fornecedores.data?.data ?? []).map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <span className="text-sm text-muted">
              {marcadas.length} {marcadas.length === 1 ? 'peça marcada' : 'peças marcadas'} · <span className="font-medium text-foreground tabular">{formatBRL(total)}</span>
            </span>
          )}
          {erro && <p className="w-full text-sm text-danger">{erro}</p>}
          <Button disabled={invalido} loading={create.isPending} onClick={() => void criar()}>
            Criar rascunho de pedido
          </Button>
        </div>
      )}
    </Card>
  );
}
