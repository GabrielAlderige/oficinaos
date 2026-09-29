import type { CatalogVehicleSummary } from '@oficinaos/shared';
import { Car, Hammer, Search } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Alert, Card, Skeleton } from '../../components/ui/display';
import { Field, fieldA11y } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { EmptyState, SearchInput } from '../../components/ui/list-parts';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '../../components/ui/overlays';
import { errorMessage } from '../../lib/errors';
import { useDebouncedValue } from '../../lib/use-debounced-value';
import { useCatalogSearch, useCatalogVehicle, useRequestVehicle } from './vehicle-catalog-api';
import { nomeDoCarro, VehicleSpecSheet } from './VehicleSpecSheet';

/**
 * Consultar a ficha do carro SEM sair da OS (E37).
 *
 * O mecânico está com a OS aberta e precisa do óleo de um carro — às vezes o
 * da OS, às vezes o que está do lado no elevador. Mandar ele para outra tela
 * faria perder o que estava fazendo, então a mesma busca da tela "Ficha do
 * carro" cabe aqui dentro: já vem com o carro da OS escrito, e ele apaga e
 * procura outro se quiser.
 */
export function ConsultaDoCarroDialog({
  aberto,
  onFechar,
  sugestao = '',
}: {
  aberto: boolean;
  onFechar(): void;
  /** o carro da OS, já escrito na busca — quem veio de lá não digita de novo */
  sugestao?: string;
}) {
  const [busca, setBusca] = useState(sugestao);
  const [abertaId, setAbertaId] = useState<string | null>(null);
  const [pedindo, setPedindo] = useState(false);

  const q = useDebouncedValue(busca.trim(), 300);
  const resultados = useCatalogSearch(q, false, aberto && q.length >= 2);
  const ficha = useCatalogVehicle(abertaId);
  const achou = resultados.data?.data ?? [];

  /** fechar volta ao estado de quem abriu: o carro da OS, sem ficha aberta */
  function fechar() {
    setBusca(sugestao);
    setAbertaId(null);
    setPedindo(false);
    onFechar();
  }

  return (
    <>
      {/* o "pedir carro" é irmão, não filho: dois diálogos empilhados brigam
          pelo foco e o de baixo fica clicável por trás do de cima */}
      <Dialog open={aberto && !pedindo} onOpenChange={(estado) => !estado && fechar()}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          {abertaId ? (
            <>
              {ficha.isPending ? (
                <Skeleton className="h-64 w-full" />
              ) : ficha.isError ? (
                <Alert variant="danger">{errorMessage(ficha.error)}</Alert>
              ) : ficha.data ? (
                <VehicleSpecSheet ficha={ficha.data} />
              ) : null}
              <DialogFooter>
                <Button variant="secondary" onClick={() => setAbertaId(null)}>
                  Procurar outro carro
                </Button>
                <Button onClick={fechar}>Voltar para a OS</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader
                title="Consultar ficha do carro"
                description="Óleo, fluido, medida de pneu. Pode ser o carro desta OS ou qualquer outro."
              />
              <SearchInput
                value={busca}
                onChange={setBusca}
                autoFocus
                label="Buscar carro na ficha"
                placeholder="Ex.: Gol 2013, Onix 1.0, HB20"
              />

              {resultados.isError && <Alert variant="danger">{errorMessage(resultados.error)}</Alert>}

              {q.length < 2 ? (
                <EmptyState
                  icon={Search}
                  title="Digite o carro"
                  description="Marca, modelo e ano — como “Gol 2013”. A ficha abre com o que serve nele."
                />
              ) : resultados.isPending ? (
                <div className="space-y-3">
                  {Array.from({ length: 2 }, (_, i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))}
                </div>
              ) : achou.length === 0 ? (
                <EmptyState
                  icon={Hammer}
                  title={`“${q}” ainda está em desenvolvimento`}
                  description="Este carro ainda não entrou no catálogo. Estamos preenchendo aos poucos, começando pelos mais pedidos — peça o seu e ele entra na fila."
                  action={<Button onClick={() => setPedindo(true)}>Pedir este carro</Button>}
                />
              ) : (
                <ul className="space-y-3">
                  {achou.map((carro) => (
                    <li key={carro.id}>
                      <CartaoDoCarro carro={carro} onAbrir={() => setAbertaId(carro.id)} />
                    </li>
                  ))}
                </ul>
              )}

              <DialogFooter>
                <Button asChild variant="ghost">
                  <Link to={`/ficha-do-carro${busca.trim() ? `?q=${encodeURIComponent(busca.trim())}` : ''}`}>
                    Abrir a tela de pesquisa
                  </Link>
                </Button>
                <Button variant="secondary" onClick={fechar}>
                  Fechar
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <PedirCarroDialog aberto={pedindo} onFechar={() => setPedindo(false)} sugestao={q} />
    </>
  );
}

export function CartaoDoCarro({ carro, onAbrir }: { carro: CatalogVehicleSummary; onAbrir(): void }) {
  return (
    <Card>
      <button
        type="button"
        onClick={onAbrir}
        className="flex w-full items-center gap-3 rounded-xl px-5 py-4 text-left hover:bg-surface-muted/60"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-muted text-muted">
          <Car className="size-4" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{nomeDoCarro(carro)}</span>
          <span className="block text-xs text-muted">
            {carro.filledCount} {carro.filledCount === 1 ? 'item na ficha' : 'itens na ficha'}
          </span>
        </span>
        <span className="shrink-0 text-sm text-accent">Ver ficha</span>
      </button>
    </Card>
  );
}

/** O pedido vira a fila: o carro mais pedido é o próximo a ser preenchido. */
export function PedirCarroDialog({
  aberto,
  onFechar,
  sugestao,
}: {
  aberto: boolean;
  onFechar(): void;
  sugestao: string;
}) {
  const pedir = useRequestVehicle();
  const [marca, setMarca] = useState('');
  const [modelo, setModelo] = useState('');
  const [ano, setAno] = useState('');

  return (
    <Dialog
      open={aberto}
      onOpenChange={(estado) => {
        if (!estado) onFechar();
      }}
    >
      <DialogContent>
        <DialogHeader
          title="Pedir um carro"
          description={`Anotamos e entra na fila. Os mais pedidos são os primeiros a serem preenchidos.${sugestao ? ` Você procurou por “${sugestao}”.` : ''}`}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Marca" htmlFor="pedir-marca">
            <Input
              {...fieldA11y('pedir-marca')}
              autoFocus
              value={marca}
              onChange={(evento) => setMarca(evento.target.value)}
              placeholder="Ex.: Fiat"
            />
          </Field>
          <Field label="Modelo" htmlFor="pedir-modelo">
            <Input
              {...fieldA11y('pedir-modelo')}
              value={modelo}
              onChange={(evento) => setModelo(evento.target.value)}
              placeholder="Ex.: Toro"
            />
          </Field>
          <Field label="Ano" htmlFor="pedir-ano" hint="Opcional.">
            <Input
              {...fieldA11y('pedir-ano', undefined, true)}
              inputMode="numeric"
              value={ano}
              onChange={(evento) => setAno(evento.target.value)}
              placeholder="Ex.: 2020"
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onFechar}>
            Cancelar
          </Button>
          <Button
            loading={pedir.isPending}
            onClick={async () => {
              if (!marca.trim() || !modelo.trim()) {
                toast.error('Informe a marca e o modelo.');
                return;
              }
              try {
                const resposta = await pedir.mutateAsync({
                  make: marca.trim(),
                  model: modelo.trim(),
                  year: ano.trim() ? Number(ano.replace(/\D/g, '')) || null : null,
                  note: '',
                });
                toast.success(resposta.message);
                setMarca('');
                setModelo('');
                setAno('');
                onFechar();
              } catch (erro) {
                toast.error(errorMessage(erro));
              }
            }}
          >
            Pedir carro
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
