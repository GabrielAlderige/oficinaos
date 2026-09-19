import { formatBRL, type PriceListImportResult } from '@oficinaos/shared';
import { FileSpreadsheet, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Alert, Card, CardHeader, Skeleton } from '../../components/ui/display';
import { EmptyState, Pagination, SearchInput } from '../../components/ui/list-parts';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '../../components/ui/overlays';
import { errorMessage } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';
import { useCan } from '../../lib/session';
import { useDebouncedValue } from '../../lib/use-debounced-value';
import { useImportPriceList, usePriceList } from './api';

/**
 * A lista de preço do fornecedor (E14). A oficina recebe a planilha por
 * WhatsApp e, a partir daqui, a pesquisa de peças compara com ela junto com o
 * estoque e as cotações. O arquivo é lido no navegador e vai como texto: a
 * planilha não passa por storage nenhum.
 */
export function PriceListCard({ supplierId, supplierName }: { supplierId: string; supplierName: string }) {
  const podeVerCusto = useCan('parts:view_cost');
  const podeImportar = useCan('suppliers:write');
  const [page, setPage] = useState(1);
  const [busca, setBusca] = useState('');
  const q = useDebouncedValue(busca.trim(), 300);
  const [importando, setImportando] = useState(false);
  const lista = usePriceList(supplierId, { q, page }, podeVerCusto);

  if (!podeVerCusto) return null;

  return (
    <Card>
      <CardHeader
        title="Lista de preço"
        description={
          lista.data?.importedAt
            ? `${lista.data.itemCount} ${lista.data.itemCount === 1 ? 'item' : 'itens'} · atualizada em ${formatDateTime(lista.data.importedAt)}`
            : 'A planilha que o fornecedor manda, usada na pesquisa de peças.'
        }
        action={
          podeImportar && (
            <Button variant="secondary" size="sm" onClick={() => setImportando(true)}>
              <Upload />
              Importar CSV
            </Button>
          )
        }
      />

      {lista.isPending ? (
        <div className="space-y-2 p-5">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : lista.isError ? (
        <div className="p-5">
          <Alert variant="danger">{errorMessage(lista.error)}</Alert>
        </div>
      ) : !lista.data?.items.length && !q ? (
        <EmptyState
          icon={FileSpreadsheet}
          title="Nenhuma lista importada"
          description="Importe o CSV que o fornecedor manda: código, descrição, marca e preço. A pesquisa de peças passa a comparar com ele."
        />
      ) : (
        <>
          <div className="border-b border-border p-3">
            <SearchInput value={busca} onChange={setBusca} placeholder="Código ou descrição" label="Buscar na lista" />
          </div>
          {!lista.data.items.length ? (
            <p className="px-5 py-8 text-center text-sm text-muted">Nada com esse termo na lista.</p>
          ) : (
            <ul className="divide-y divide-border">
              {lista.data.items.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-4 px-5 py-2.5">
                  <span className="min-w-0">
                    <span className="block truncate text-sm">{item.name}</span>
                    <span className="block text-xs text-muted">{[item.code, item.brand].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="shrink-0 text-sm font-medium tabular">{formatBRL(item.priceCents)}</span>
                </li>
              ))}
            </ul>
          )}
          <Pagination meta={lista.data.meta} onPageChange={setPage} />
        </>
      )}

      <ImportDialog
        supplierId={supplierId}
        supplierName={supplierName}
        open={importando}
        onOpenChange={setImportando}
      />
    </Card>
  );
}

function ImportDialog({ supplierId, supplierName, open, onOpenChange }: {
  supplierId: string;
  supplierName: string;
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const importar = useImportPriceList(supplierId);
  const input = useRef<HTMLInputElement>(null);
  const [arquivo, setArquivo] = useState<{ nome: string; csv: string } | null>(null);
  const [trocar, setTrocar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<PriceListImportResult | null>(null);

  function fechar() {
    setArquivo(null);
    setErro(null);
    setResultado(null);
    setTrocar(false);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={(proximo) => (proximo ? onOpenChange(true) : fechar())}>
      <DialogContent>
        <DialogHeader
          title="Importar lista de preço"
          description={`A planilha de ${supplierName}. Aceita ponto e vírgula ou vírgula, com as colunas código, descrição, marca, preço e unidade.`}
        />

        {resultado ? (
          <div className="space-y-3">
            <Alert variant="success">
              {resultado.imported} {resultado.imported === 1 ? 'item novo' : 'itens novos'} e {resultado.updated}{' '}
              {resultado.updated === 1 ? 'atualizado' : 'atualizados'}
              {resultado.removed > 0 && `, ${resultado.removed} ${resultado.removed === 1 ? 'removido' : 'removidos'}`}.
            </Alert>
            {resultado.skipped > 0 && (
              <div className="rounded-lg border border-border p-3 text-sm">
                <p className="font-medium">
                  {resultado.skipped} {resultado.skipped === 1 ? 'linha recusada' : 'linhas recusadas'}
                </p>
                <ul className="mt-1 space-y-0.5 text-xs text-muted">
                  {resultado.problems.map((problema) => (
                    <li key={problema.line}>
                      linha {problema.line}: {problema.reason}
                    </li>
                  ))}
                  {resultado.skipped > resultado.problems.length && <li>…</li>}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {erro && <Alert variant="danger">{erro}</Alert>}
            <input
              ref={input}
              type="file"
              accept=".csv,text/csv,text/plain"
              className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-surface-muted file:px-3 file:py-1.5 file:text-sm"
              aria-label="Arquivo CSV"
              onChange={async (event) => {
                const escolhido = event.target.files?.[0];
                setErro(null);
                if (!escolhido) return setArquivo(null);
                if (escolhido.size > 4_000_000) {
                  setErro('Arquivo grande demais (máximo 4 MB).');
                  return;
                }
                setArquivo({ nome: escolhido.name, csv: await escolhido.text() });
              }}
            />
            {arquivo && <p className="text-xs text-muted">{arquivo.nome}</p>}
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-4 rounded border-border"
                checked={trocar}
                onChange={(event) => setTrocar(event.target.checked)}
              />
              <span>
                Trocar a lista inteira
                <span className="block text-xs text-muted">
                  O que não vier neste arquivo é removido. Sem marcar, os preços são atualizados pelo código e o resto
                  fica.
                </span>
              </span>
            </label>
          </div>
        )}

        <DialogFooter>
          <Button variant="secondary" onClick={fechar}>
            {resultado ? 'Fechar' : 'Cancelar'}
          </Button>
          {!resultado && (
            <Button
              loading={importar.isPending}
              disabled={!arquivo}
              onClick={async () => {
                if (!arquivo) return;
                setErro(null);
                try {
                  setResultado(await importar.mutateAsync({ csv: arquivo.csv, replace: trocar }));
                  toast.success('Lista importada.');
                } catch (err) {
                  setErro(errorMessage(err));
                }
              }}
            >
              Importar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
