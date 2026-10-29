import { formatBRL, formatQuantity, type DashboardPeriod } from '@oficinaos/shared';
import { ArrowLeftRight, Building2, Plus, Search, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Alert, Badge, Card, PageHeader, Skeleton } from '../../components/ui/display';
import { Field, fieldA11y, Select } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '../../components/ui/overlays';
import { errorMessage } from '../../lib/errors';
import { useSession } from '../../lib/session';
import { useDebouncedValue } from '../../lib/use-debounced-value';
import { useParts } from '../catalog/api';
import { useCreateUnit, useNetwork, useStockTransfer } from './api';

const PERIODOS: { valor: DashboardPeriod; rotulo: string }[] = [
  { valor: 'today', rotulo: 'Hoje' },
  { valor: 'week', rotulo: 'Esta semana' },
  { valor: 'month', rotulo: 'Este mês' },
  { valor: 'last30', rotulo: 'Últimos 30 dias' },
];

/**
 * A rede de oficinas (E50): o resultado de cada unidade lado a lado, abrir
 * unidade nova e mandar peça de uma para a outra. Cada unidade continua sendo
 * uma oficina inteira — para trabalhar nela, troque no seletor do menu.
 */
export function NetworkPage() {
  const [periodo, setPeriodo] = useState<DashboardPeriod>('month');
  const rede = useNetwork(periodo);
  const [abrindo, setAbrindo] = useState(false);
  const [transferindo, setTransferindo] = useState(false);
  const dados = rede.data;

  return (
    <>
      <PageHeader
        title="Minha rede"
        description="O resultado de cada unidade, lado a lado. Para trabalhar numa unidade, troque no seletor do menu."
        actions={
          <span className="flex flex-wrap gap-2">
            <Select aria-label="Período" value={periodo} onChange={(e) => setPeriodo(e.target.value as DashboardPeriod)} className="w-auto">
              {PERIODOS.map((p) => (
                <option key={p.valor} value={p.valor}>
                  {p.rotulo}
                </option>
              ))}
            </Select>
            {(dados?.units.length ?? 0) > 1 && (
              <Button variant="secondary" onClick={() => setTransferindo(true)}>
                <ArrowLeftRight />
                Transferir peças
              </Button>
            )}
            <Button onClick={() => setAbrindo(true)}>
              <Plus />
              Abrir nova unidade
            </Button>
          </span>
        }
      />

      {rede.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : rede.isError ? (
        <Alert variant="danger">{errorMessage(rede.error)}</Alert>
      ) : dados ? (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted">
                  <th scope="col" className="px-5 py-2.5 text-left font-medium">Unidade</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Faturado</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Recebido</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">OS finalizadas</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Carros na oficina</th>
                  <th scope="col" className="px-5 py-2.5 text-right font-medium">Estoque (custo)</th>
                </tr>
              </thead>
              <tbody>
                {dados.units.map((unidade) => (
                  <tr key={unidade.id} className="border-b border-border">
                    <th scope="row" className="px-5 py-3 text-left font-medium">
                      <span className="inline-flex items-center gap-2">
                        <Building2 className="size-4 text-muted" aria-hidden="true" />
                        {unidade.name}
                        {unidade.isCurrent && <Badge tone="accent">você está aqui</Badge>}
                      </span>
                    </th>
                    <td className="px-3 py-3 text-right tabular">{formatBRL(unidade.billedCents)}</td>
                    <td className="px-3 py-3 text-right tabular">{formatBRL(unidade.receivedCents)}</td>
                    <td className="px-3 py-3 text-right tabular">{unidade.completedOrders}</td>
                    <td className="px-3 py-3 text-right tabular">{unidade.vehiclesInShop}</td>
                    <td className="px-5 py-3 text-right tabular">
                      {unidade.stockValueCents === null ? '—' : formatBRL(unidade.stockValueCents)}
                    </td>
                  </tr>
                ))}
                <tr className="bg-surface-muted/60 font-semibold">
                  <th scope="row" className="px-5 py-3 text-left">Total da rede</th>
                  <td className="px-3 py-3 text-right tabular">{formatBRL(dados.totals.billedCents)}</td>
                  <td className="px-3 py-3 text-right tabular">{formatBRL(dados.totals.receivedCents)}</td>
                  <td className="px-3 py-3 text-right tabular">{dados.totals.completedOrders}</td>
                  <td className="px-3 py-3 text-right tabular">{dados.totals.vehiclesInShop}</td>
                  <td className="px-5 py-3 text-right tabular">{formatBRL(dados.totals.stockValueCents)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {dados.units.length === 1 && (
            <p className="border-t border-border px-5 py-3 text-sm text-muted">
              Por enquanto a rede tem uma unidade só. Ao abrir a segunda, o resultado das duas aparece aqui, e dá para mandar peça
              de uma para a outra.
            </p>
          )}
        </Card>
      ) : null}

      {abrindo && <AbrirUnidade onClose={() => setAbrindo(false)} />}
      {transferindo && dados && (
        <Transferir unidades={dados.units.filter((u) => !u.isCurrent).map((u) => ({ id: u.id, name: u.name }))} onClose={() => setTransferindo(false)} />
      )}
    </>
  );
}

function AbrirUnidade({ onClose }: { onClose(): void }) {
  const criar = useCreateUnit();
  const { switchOrganization } = useSession();
  const navigate = useNavigate();
  const [nome, setNome] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [copiar, setCopiar] = useState(true);
  const [criada, setCriada] = useState<{ id: string; name: string } | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function confirmar() {
    setErro(null);
    try {
      setCriada(await criar.mutateAsync({ name: nome, whatsapp, copyCatalog: copiar }));
    } catch (err) {
      setErro(errorMessage(err));
    }
  }

  async function entrar() {
    if (!criada) return;
    try {
      await switchOrganization(criada.id);
      toast.success(`Agora você está em ${criada.name}.`);
      navigate('/');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !criar.isPending && onClose()}>
      <DialogContent>
        {criada ? (
          <>
            <DialogHeader title={`${criada.name} está aberta`} description="A unidade nova já está na sua rede e no seletor do menu, com o próprio teste grátis." />
            <DialogFooter>
              <Button variant="secondary" onClick={onClose}>
                Ficar aqui
              </Button>
              <Button onClick={() => void entrar()}>Entrar na unidade nova</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader
              title="Abrir nova unidade"
              description="Uma oficina inteira: clientes, estoque e caixa próprios, com a própria assinatura. Você entra como dono."
            />
            <div className="grid gap-4">
              <Field label="Nome da unidade" htmlFor="un-nome">
                <Input {...fieldA11y('un-nome')} value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Kers Centro" maxLength={80} />
              </Field>
              <Field label="WhatsApp da unidade (opcional)" htmlFor="un-whats">
                <Input {...fieldA11y('un-whats')} value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} inputMode="tel" />
              </Field>
              <label className="flex items-start gap-2.5 text-sm">
                <input type="checkbox" className="mt-0.5 size-4" checked={copiar} onChange={(e) => setCopiar(e.target.checked)} />
                <span>
                  Copiar o catálogo desta unidade
                  <span className="block text-xs text-muted">Serviços, peças (sem o estoque) e checklists. Clientes e dinheiro não são copiados.</span>
                </span>
              </label>
              {erro && <Alert variant="danger">{erro}</Alert>}
            </div>
            <DialogFooter>
              <Button variant="secondary" onClick={onClose} disabled={criar.isPending}>
                Cancelar
              </Button>
              <Button loading={criar.isPending} disabled={nome.trim().length < 2} onClick={() => void confirmar()}>
                Abrir unidade
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface Linha {
  partId: string;
  name: string;
  disponivel: number;
  unidade: string;
  quantidade: string;
}

function Transferir({ unidades, onClose }: { unidades: { id: string; name: string }[]; onClose(): void }) {
  const transferir = useStockTransfer();
  const [destino, setDestino] = useState(unidades[0]?.id ?? '');
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [busca, setBusca] = useState('');
  const q = useDebouncedValue(busca.trim(), 250);
  const pecas = useParts({ q, page: 1, pageSize: 6, attention: false }, { enabled: q.length >= 2 });
  const [erro, setErro] = useState<string | null>(null);

  async function confirmar() {
    setErro(null);
    try {
      const resultado = await transferir.mutateAsync({
        toOrganizationId: destino,
        items: linhas.map((l) => ({ partId: l.partId, quantity: Number(l.quantidade.replace(',', '.')) || 0 })),
      });
      const novas = resultado.items.filter((i) => i.createdAtDestination).length;
      toast.success(
        `Peças enviadas para ${resultado.toName}.${novas ? ` ${novas} ${novas === 1 ? 'peça foi cadastrada' : 'peças foram cadastradas'} lá.` : ''}`,
      );
      onClose();
    } catch (err) {
      setErro(errorMessage(err));
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !transferir.isPending && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader
          title="Transferir peças"
          description="A peça sai do disponível desta unidade e entra na outra pelo mesmo custo. Se a outra não tiver a peça, ela é cadastrada lá."
        />
        <div className="grid gap-4">
          <Field label="Para qual unidade" htmlFor="tr-destino">
            <Select id="tr-destino" value={destino} onChange={(e) => setDestino(e.target.value)}>
              {unidades.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Peça" htmlFor="tr-busca">
            <div className="relative">
              <Input {...fieldA11y('tr-busca')} value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar peça" autoComplete="off" />
              <Search className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
              {q.length >= 2 && !!pecas.data?.data.length && (
                <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-border bg-surface shadow-lg">
                  {pecas.data.data.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        className="flex w-full justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-surface-muted"
                        onClick={() => {
                          setLinhas((atuais) =>
                            atuais.some((l) => l.partId === p.id)
                              ? atuais
                              : [...atuais, { partId: p.id, name: p.name, disponivel: p.quantityAvailable, unidade: p.unit, quantidade: '1' }],
                          );
                          setBusca('');
                        }}
                      >
                        <span className="truncate">{p.name}</span>
                        <span className="shrink-0 text-xs text-muted">disponível {formatQuantity(Math.round(p.quantityAvailable * 1000), p.unit)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Field>
          {linhas.length > 0 && (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {linhas.map((l) => (
                <li key={l.partId} className="flex items-center gap-3 px-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{l.name}</span>
                    <span className="text-xs text-muted">disponível {formatQuantity(Math.round(l.disponivel * 1000), l.unidade)}</span>
                  </span>
                  <Input
                    aria-label={`Quantidade de ${l.name}`}
                    className="w-20"
                    inputMode="decimal"
                    value={l.quantidade}
                    onChange={(e) =>
                      setLinhas((atuais) => atuais.map((x) => (x.partId === l.partId ? { ...x, quantidade: e.target.value.replace(/[^\d,.]/g, '') } : x)))
                    }
                  />
                  <Button variant="ghost" size="icon" className="size-8" aria-label={`Tirar ${l.name}`} onClick={() => setLinhas((a) => a.filter((x) => x.partId !== l.partId))}>
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {erro && <Alert variant="danger">{erro}</Alert>}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={transferir.isPending}>
            Cancelar
          </Button>
          <Button loading={transferir.isPending} disabled={!linhas.length || !destino} onClick={() => void confirmar()}>
            Transferir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
