import { formatBRL, formatQuantity, PART_UNIT_SHORT, type PartUnit, type PurchaseSuggestions } from '@oficinaos/shared';
import { ClipboardCopy, Lightbulb, PackagePlus } from 'lucide-react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Alert, Badge, Card, PageHeader, Skeleton } from '../../components/ui/display';
import { EmptyState } from '../../components/ui/list-parts';
import { errorMessage } from '../../lib/errors';
import { useCan } from '../../lib/session';
import { usePurchaseSuggestions } from './api';
import { PartsTabs } from './PartsTabs';

type Item = PurchaseSuggestions['groups'][number]['items'][number];

/** A API manda a quantidade em unidades e a unidade como código ('UNIT', 'LITER'). */
const quantidadeLegivel = (item: Item) =>
  formatQuantity(Math.round(item.quantity * 1000), PART_UNIT_SHORT[item.unit as PartUnit] ?? item.unit);

/**
 * O que está na hora de pedir.
 *
 * Duas origens, e a tela diz qual é qual: peça **abaixo do estoque mínimo** e
 * peça que uma **OS em andamento espera** e não tem na prateleira. A conta é
 * do servidor (`/purchase-orders/suggestions`), a mesma de sempre.
 *
 * A compra em si acontece fora do sistema — no WhatsApp do fornecedor, no
 * telefone, no balcão do distribuidor. Por isso o botão principal é **copiar a
 * lista**: o texto vai pronto para colar onde a oficina já compra. Quando a
 * peça chegar, a entrada é registrada na ficha dela, com o custo, e o custo
 * médio se atualiza como sempre.
 */
export function ReorderPage() {
  const sugestoes = usePurchaseSuggestions();
  const podeVerCusto = useCan('parts:view_cost');

  const itens = (sugestoes.data?.groups ?? []).flatMap((grupo) => grupo.items);
  const abaixoDoMinimo = itens.filter((item) => item.kind === 'RESTOCK');
  const paraOS = itens.filter((item) => item.kind !== 'RESTOCK');

  async function copiar() {
    const linhas = itens.map(
      (item) =>
        `• ${item.partName}${item.partCode ? ` (${item.partCode})` : ''} — ${quantidadeLegivel(item)}`,
    );
    try {
      await navigator.clipboard.writeText(linhas.join('\n'));
      toast.success(`${linhas.length} ${linhas.length === 1 ? 'item copiado' : 'itens copiados'}.`);
    } catch {
      toast.error('Não deu para copiar. Selecione a lista e copie na mão.');
    }
  }

  return (
    <>
      <PageHeader
        title="Peças e estoque"
        description="O que repor antes de faltar, e o que as ordens de serviço estão esperando."
        actions={
          itens.length > 0 && (
            <Button variant="secondary" onClick={() => void copiar()}>
              <ClipboardCopy />
              Copiar lista
            </Button>
          )
        }
      />
      <PartsTabs />

      {sugestoes.isPending ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : sugestoes.isError ? (
        <Alert variant="danger">{errorMessage(sugestoes.error)}</Alert>
      ) : !itens.length ? (
        <Card>
          <EmptyState
            icon={Lightbulb}
            title="Nada para pedir agora"
            description="Nenhuma peça está abaixo do mínimo e nenhuma OS espera peça que falte. Defina o estoque mínimo na ficha da peça para ela aparecer aqui."
          />
        </Card>
      ) : (
        <div className="space-y-5">
          <Lista
            titulo="Acabando no estoque"
            descricao="Abaixo do mínimo que você definiu na ficha da peça."
            itens={abaixoDoMinimo}
            podeVerCusto={podeVerCusto}
          />
          <Lista
            titulo="As ordens de serviço estão esperando"
            descricao="Peça aprovada numa OS em andamento que não tem na prateleira."
            itens={paraOS}
            podeVerCusto={podeVerCusto}
          />
        </div>
      )}
    </>
  );
}

function Lista({
  titulo,
  descricao,
  itens,
  podeVerCusto,
}: {
  titulo: string;
  descricao: string;
  itens: Item[];
  podeVerCusto: boolean;
}) {
  if (!itens.length) return null;

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
        <div>
          <p className="font-medium">{titulo}</p>
          <p className="text-sm text-muted">{descricao}</p>
        </div>
        <Badge tone={itens.length > 0 ? 'warning' : 'neutral'}>
          {itens.length} {itens.length === 1 ? 'peça' : 'peças'}
        </Badge>
      </div>
      <ul className="divide-y divide-border">
        {itens.map((item) => (
          <li key={`${item.kind}-${item.partId}-${item.workOrderItemId ?? ''}`} className="px-5 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <Link to={`/pecas/${item.partId}`} className="font-medium hover:underline">
                {item.partName}
              </Link>
              <span className="tabular text-sm font-semibold">{quantidadeLegivel(item)}</span>
            </div>
            <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted">
              {item.partCode && <span>{item.partCode}</span>}
              <span>{item.reason}</span>
              {podeVerCusto && item.unitCostCents !== null && (
                <span className="tabular">· último custo {formatBRL(item.unitCostCents)}</span>
              )}
            </p>
          </li>
        ))}
      </ul>
      <p className="flex items-start gap-2 border-t border-border px-5 py-3 text-xs text-muted">
        <PackagePlus className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        Quando a peça chegar, abra a ficha dela e registre a <strong>entrada</strong> com o valor pago: é isso que
        mantém o custo médio e o preço sugerido certos.
      </p>
    </Card>
  );
}
