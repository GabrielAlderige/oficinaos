import { Hammer, Search } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { Button } from '../../components/ui/button';
import { Alert, Card, PageHeader, Skeleton } from '../../components/ui/display';
import { EmptyState, SearchInput } from '../../components/ui/list-parts';
import { Dialog, DialogContent, DialogFooter } from '../../components/ui/overlays';
import { errorMessage } from '../../lib/errors';
import { useDebouncedValue } from '../../lib/use-debounced-value';
import { CartaoDoCarro, PedirCarroDialog } from './ConsultaDoCarro';
import { useCatalogCoverage, useCatalogSearch, useCatalogVehicle } from './vehicle-catalog-api';
import { VehicleSpecSheet } from './VehicleSpecSheet';

/**
 * Ficha do carro (E31).
 *
 * A oficina digita o carro e vê óleo, filtro, pastilha, torque de roda. O
 * catálogo é da plataforma e está sendo preenchido — por isso a tela diz
 * quantos carros já existem e, quando não acha, **não** finge: avisa que
 * aquele ainda está em desenvolvimento e deixa pedir. Carro pedido vira fila
 * de prioridade de quem preenche.
 */
export function VehicleCatalogPage() {
  // ?q= chega da OS com o carro já escrito: quem veio de lá não digita de novo
  const [params] = useSearchParams();
  const [busca, setBusca] = useState(() => params.get('q') ?? '');
  const q = useDebouncedValue(busca.trim(), 300);
  const cobertura = useCatalogCoverage();
  const resultados = useCatalogSearch(q, false, q.length >= 2);
  const [abertaId, setAbertaId] = useState<string | null>(null);
  const [pedindo, setPedindo] = useState(false);
  const ficha = useCatalogVehicle(abertaId);

  const achou = resultados.data?.data ?? [];
  const procurou = q.length >= 2 && !resultados.isPending;

  return (
    <>
      <PageHeader
        title="Ficha do carro"
        description="Óleo, filtro, pastilha, torque de roda: o que serve em cada carro, sem abrir catálogo de fabricante."
      />

      <Card className="mb-5">
        <div className="p-4 sm:p-5">
          <SearchInput
            value={busca}
            onChange={setBusca}
            autoFocus
            label="Buscar carro na ficha"
            placeholder="Ex.: Gol 2013, Onix 1.0, HB20"
          />
          <p className="mt-2 text-xs text-muted">
            {cobertura.isPending
              ? 'Carregando o catálogo…'
              : cobertura.data?.publishedVehicles
                ? `${cobertura.data.publishedVehicles} ${cobertura.data.publishedVehicles === 1 ? 'carro disponível' : 'carros disponíveis'} hoje. Estamos preenchendo mais a cada semana.`
                : 'O catálogo está começando agora. Peça o seu carro e ele entra na fila.'}
          </p>
        </div>
      </Card>

      {resultados.isError && <Alert variant="danger">{errorMessage(resultados.error)}</Alert>}

      {q.length < 2 ? (
        <Card>
          <EmptyState
            icon={Search}
            title="Digite o carro"
            description="Marca, modelo e ano — como “Gol 2013”. A ficha abre com o que serve nele."
          />
        </Card>
      ) : resultados.isPending ? (
        <div className="space-y-3">
          {Array.from({ length: 2 }, (_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : achou.length === 0 ? (
        <Card>
          <EmptyState
            icon={Hammer}
            title={`“${q}” ainda está em desenvolvimento`}
            description="Este carro ainda não entrou no catálogo. Estamos preenchendo aos poucos, começando pelos mais pedidos — peça o seu e ele entra na fila."
            action={<Button onClick={() => setPedindo(true)}>Pedir este carro</Button>}
          />
        </Card>
      ) : (
        <ul className="space-y-3">
          {achou.map((carro) => (
            <li key={carro.id}>
              <CartaoDoCarro carro={carro} onAbrir={() => setAbertaId(carro.id)} />
            </li>
          ))}
        </ul>
      )}

      {procurou && achou.length > 0 && (
        <p className="mt-4 text-center text-sm text-muted">
          Não é nenhum desses?{' '}
          <Button variant="link" size="sm" onClick={() => setPedindo(true)}>
            Peça o seu carro
          </Button>
        </p>
      )}

      <Dialog open={abertaId !== null} onOpenChange={(aberto) => !aberto && setAbertaId(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          {ficha.isPending ? (
            <Skeleton className="h-64 w-full" />
          ) : ficha.isError ? (
            <Alert variant="danger">{errorMessage(ficha.error)}</Alert>
          ) : ficha.data ? (
            <VehicleSpecSheet ficha={ficha.data} />
          ) : null}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setAbertaId(null)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PedirCarroDialog aberto={pedindo} onFechar={() => setPedindo(false)} sugestao={q} />
    </>
  );
}
