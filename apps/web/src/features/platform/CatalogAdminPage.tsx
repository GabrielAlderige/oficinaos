import {
  SPEC_GROUP_LABELS,
  SPEC_GROUPS,
  SPEC_ITEMS,
  type CatalogVehicle,
  type CatalogVehicleSummary,
  type SpecGroup,
  type SpecValue,
} from '@oficinaos/shared';
import { Car, ListChecks, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Navigate } from 'react-router';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Alert, Badge, Card, CardHeader, PageHeader, Skeleton } from '../../components/ui/display';
import { Field, fieldA11y } from '../../components/ui/field';
import { Input, Textarea } from '../../components/ui/input';
import { EmptyState, SearchInput } from '../../components/ui/list-parts';
import { ConfirmDialog } from '../../components/ui/overlays';
import { cn } from '../../lib/cn';
import { errorMessage } from '../../lib/errors';
import { useMe } from '../../lib/session';
import { useDebouncedValue } from '../../lib/use-debounced-value';
import {
  useCatalogQueue,
  useCatalogSearch,
  useCatalogVehicle,
  useDeleteCatalogVehicle,
  useSaveCatalogVehicle,
} from '../catalog/vehicle-catalog-api';
import { nomeDoCarro } from '../catalog/VehicleSpecSheet';

/**
 * Onde o catálogo é preenchido (E31).
 *
 * Fora do painel da oficina: isto é da PLATAFORMA. Quem entra são as contas
 * marcadas como administrador — nenhum papel de oficina, nem o dono, chega
 * aqui. A fila de carros pedidos fica ao lado do formulário de propósito:
 * ela é a lista de trabalho, e trabalhar pela fila é o que faz o catálogo
 * crescer na direção de quem usa.
 */
export function CatalogAdminPage() {
  const { user } = useMe();
  const [busca, setBusca] = useState('');
  const q = useDebouncedValue(busca.trim(), 300);
  // as consultas só saem para quem é administrador: os hooks rodam ANTES do
  // redirecionamento abaixo, e sem isto quem cai aqui por engano dispara 403
  const lista = useCatalogSearch(q, true, user.isPlatformAdmin);
  const fila = useCatalogQueue(user.isPlatformAdmin);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const ficha = useCatalogVehicle(editandoId);

  // a marca é da conta; quem não tem cai fora antes de ver qualquer coisa
  if (!user.isPlatformAdmin) return <Navigate to="/" replace />;

  return (
    <>
      <PageHeader
        title="Catálogo de veículos"
        description="As fichas que todas as oficinas leem. Rascunho não aparece para ninguém até você publicar."
        actions={
          <Button
            onClick={() => {
              setEditandoId(null);
              setCriando(true);
            }}
          >
            <Plus />
            Novo carro
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-4">
          {criando || editandoId ? (
            <FichaForm
              /* o `key` é o que faz o formulário RENASCER quando a ficha chega:
                 sem ele o estado inicial é montado com os dados ainda vazios, e
                 editar um carro existente abria tudo em branco */
              key={ficha.data?.id ?? 'novo'}
              ficha={editandoId ? ficha.data : undefined}
              carregando={Boolean(editandoId) && ficha.isPending}
              onSair={() => {
                setCriando(false);
                setEditandoId(null);
              }}
            />
          ) : (
            <>
              <Card>
                <div className="p-4">
                  <SearchInput value={busca} onChange={setBusca} label="Buscar no catálogo" placeholder="Marca ou modelo" />
                </div>
              </Card>
              {lista.isPending ? (
                <Skeleton className="h-32 w-full" />
              ) : !lista.data?.data.length ? (
                <Card>
                  <EmptyState
                    icon={Car}
                    title={q ? `Nada para “${q}”` : 'Nenhum carro no catálogo ainda'}
                    description="Comece pelos que mais entram numa oficina de bairro: Gol, Onix, HB20, Strada, Uno, Palio."
                  />
                </Card>
              ) : (
                <ul className="space-y-2">
                  {lista.data.data.map((carro: CatalogVehicleSummary) => (
                    <li key={carro.id}>
                      <Card>
                        <button
                          type="button"
                          onClick={() => setEditandoId(carro.id)}
                          className="flex w-full items-center gap-3 rounded-xl px-5 py-3 text-left hover:bg-surface-muted/60"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <span className="truncate font-medium">{nomeDoCarro(carro)}</span>
                              {!carro.isPublished && <Badge>Rascunho</Badge>}
                            </span>
                            <span className="block text-xs text-muted">
                              {carro.filledCount} {carro.filledCount === 1 ? 'item preenchido' : 'itens preenchidos'}
                            </span>
                          </span>
                          <span className="shrink-0 text-sm text-accent">Editar</span>
                        </button>
                      </Card>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        <Card className="h-fit">
          <CardHeader title="Carros pedidos" description="A fila de quem usa. Comece por cima." />
          {fila.isPending ? (
            <div className="p-4">
              <Skeleton className="h-20 w-full" />
            </div>
          ) : !fila.data?.length ? (
            <p className="px-5 py-6 text-center text-sm text-muted">
              Nenhuma oficina pediu carro ainda. Quando pedirem, a lista aparece aqui.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {fila.data.map((pedido) => (
                <li key={pedido.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                  <span className="min-w-0 truncate">
                    {pedido.make} {pedido.model}
                    {pedido.year ? ` ${pedido.year}` : ''}
                  </span>
                  <span className="shrink-0 text-xs text-muted">
                    {pedido.requestCount} {pedido.requestCount === 1 ? 'oficina' : 'oficinas'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

const vazio = (): SpecValue[] => [];

/** O que a tela guarda de cada item da lista fixa. */
interface CampoDoItem {
  value: string;
  note: string;
  source: string;
}
const vazioDoItem = (atual?: CampoDoItem): CampoDoItem => atual ?? { value: '', note: '', source: '' };

/**
 * O formulário da ficha. A lista fixa aparece INTEIRA, com os campos em
 * branco: quem preenche desce a lista e responde o que sabe, em vez de
 * lembrar o que existe. O que fica vazio simplesmente não é salvo.
 */
function FichaForm({ ficha, carregando, onSair }: { ficha?: CatalogVehicle; carregando: boolean; onSair(): void }) {
  const salvar = useSaveCatalogVehicle();
  const excluir = useDeleteCatalogVehicle();
  const [marca, setMarca] = useState(ficha?.make ?? '');
  const [modelo, setModelo] = useState(ficha?.model ?? '');
  const [versao, setVersao] = useState(ficha?.version ?? '');
  const [de, setDe] = useState(ficha?.yearFrom ? String(ficha.yearFrom) : '');
  const [ate, setAte] = useState(ficha?.yearTo ? String(ficha.yearTo) : '');
  const [notas, setNotas] = useState(ficha?.notes ?? '');
  const [extras, setExtras] = useState<SpecValue[]>(
    () =>
      ficha?.specs
        .filter((s) => !s.key)
        .map(({ key, customLabel, group, value, note, source }) => ({ key, customLabel, group, value, note, source })) ??
      vazio(),
  );
  const [valores, setValores] = useState<Record<string, CampoDoItem>>(() => {
    const inicial: Record<string, CampoDoItem> = {};
    for (const spec of ficha?.specs ?? []) {
      if (spec.key) inicial[spec.key] = { value: spec.value, note: spec.note, source: spec.source };
    }
    return inicial;
  });
  const [confirmando, setConfirmando] = useState(false);

  if (carregando) return <Skeleton className="h-96 w-full" />;

  const preenchidos =
    Object.values(valores).filter((v) => v.value.trim()).length + extras.filter((e) => e.value.trim()).length;

  function montarSpecs(): SpecValue[] {
    const daLista = SPEC_ITEMS.filter((item) => valores[item.key]?.value.trim()).map((item) => ({
      key: item.key,
      customLabel: '',
      group: item.group,
      value: valores[item.key]!.value.trim(),
      note: valores[item.key]!.note.trim(),
      source: valores[item.key]!.source.trim(),
    }));
    const proprios = extras
      .filter((extra) => extra.customLabel.trim() && extra.value.trim())
      .map((extra) => ({ ...extra, key: '', customLabel: extra.customLabel.trim(), value: extra.value.trim() }));
    return [...daLista, ...proprios];
  }

  async function gravar(publicar: boolean) {
    if (marca.trim().length < 2 || !modelo.trim()) {
      toast.error('Informe a marca e o modelo.');
      return;
    }
    try {
      await salvar.mutateAsync({
        id: ficha?.id,
        body: {
          make: marca.trim(),
          model: modelo.trim(),
          version: versao.trim(),
          yearFrom: de.trim() ? Number(de.replace(/\D/g, '')) || null : null,
          yearTo: ate.trim() ? Number(ate.replace(/\D/g, '')) || null : null,
          notes: notas.trim(),
          specs: montarSpecs(),
          isPublished: publicar,
        },
      });
      toast.success(publicar ? 'Ficha publicada: as oficinas já veem.' : 'Rascunho salvo.');
      onSair();
    } catch (erro) {
      toast.error(errorMessage(erro));
    }
  }

  return (
    <Card>
      <CardHeader
        title={ficha ? 'Editar ficha' : 'Nova ficha'}
        description={`${preenchidos} ${preenchidos === 1 ? 'item preenchido' : 'itens preenchidos'}. O que ficar em branco não é salvo.`}
        action={
          <Button variant="ghost" size="sm" onClick={onSair}>
            Voltar
          </Button>
        }
      />

      <div className="space-y-5 px-5 py-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Marca" htmlFor="ficha-marca">
            <Input {...fieldA11y('ficha-marca')} value={marca} onChange={(e) => setMarca(e.target.value)} placeholder="Volkswagen" />
          </Field>
          <Field label="Modelo" htmlFor="ficha-modelo">
            <Input {...fieldA11y('ficha-modelo')} value={modelo} onChange={(e) => setModelo(e.target.value)} placeholder="Gol" />
          </Field>
          <Field label="Versão / motor" htmlFor="ficha-versao" hint="O que separa uma ficha da outra.">
            <Input {...fieldA11y('ficha-versao', undefined, true)} value={versao} onChange={(e) => setVersao(e.target.value)} placeholder="G6 1.0 8V" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Ano inicial" htmlFor="ficha-de">
              <Input {...fieldA11y('ficha-de')} inputMode="numeric" value={de} onChange={(e) => setDe(e.target.value)} placeholder="2013" />
            </Field>
            <Field label="Ano final" htmlFor="ficha-ate">
              <Input {...fieldA11y('ficha-ate')} inputMode="numeric" value={ate} onChange={(e) => setAte(e.target.value)} placeholder="2016" />
            </Field>
          </div>
        </div>

        {SPEC_GROUPS.map((grupo) => (
          <section key={grupo}>
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">
              {SPEC_GROUP_LABELS[grupo as SpecGroup]}
            </h3>
            <div className="space-y-2">
              {SPEC_ITEMS.filter((item) => item.group === grupo).map((item) => (
                <div key={item.key} className="grid gap-2 sm:grid-cols-[11rem_minmax(0,1fr)] sm:items-start sm:gap-3">
                  <label htmlFor={`spec-${item.key}`} className="pt-2 text-sm text-muted">
                    {item.label}
                  </label>
                  <div className="space-y-1">
                    <Input
                      id={`spec-${item.key}`}
                      className={cn('h-9', valores[item.key]?.value.trim() && 'border-accent/40')}
                      value={valores[item.key]?.value ?? ''}
                      placeholder={item.hint}
                      onChange={(evento) =>
                        setValores((atual) => ({
                          ...atual,
                          [item.key]: { ...vazioDoItem(atual[item.key]), value: evento.target.value },
                        }))
                      }
                    />
                    {/* a fonte só aparece quando há valor: campo em branco não
                        precisa de origem, e poluiria a lista de 23 itens */}
                    {valores[item.key]?.value.trim() && (
                      <Input
                        aria-label={`Fonte de ${item.label}`}
                        className="h-8 text-xs"
                        value={valores[item.key]?.source ?? ''}
                        placeholder="De onde veio? Ex.: Manual do proprietário Gol 2022, pág. 216"
                        onChange={(evento) =>
                          setValores((atual) => ({
                            ...atual,
                            [item.key]: { ...vazioDoItem(atual[item.key]), source: evento.target.value },
                          }))
                        }
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Itens específicos deste carro</h3>
          <div className="space-y-2">
            {extras.map((extra, indice) => (
              <div key={indice} className="flex gap-2">
                <Input
                  aria-label={`Nome do item extra ${indice + 1}`}
                  className="h-9 w-44"
                  value={extra.customLabel}
                  placeholder="Ex.: Parafuso do cárter"
                  onChange={(evento) =>
                    setExtras((atual) => atual.map((e, i) => (i === indice ? { ...e, customLabel: evento.target.value } : e)))
                  }
                />
                <Input
                  aria-label={`Especificação do item extra ${indice + 1}`}
                  className="h-9 flex-1"
                  value={extra.value}
                  placeholder="Ex.: M14 · arruela nova sempre"
                  onChange={(evento) =>
                    setExtras((atual) => atual.map((e, i) => (i === indice ? { ...e, value: evento.target.value } : e)))
                  }
                />
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Remover item extra ${indice + 1}`}
                  onClick={() => setExtras((atual) => atual.filter((_, i) => i !== indice))}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                setExtras((atual) => [...atual, { key: '', customLabel: '', group: 'MOTOR', value: '', note: '', source: '' }])
              }
            >
              <ListChecks />
              Adicionar item
            </Button>
          </div>
        </section>

        <Field label="Observações da ficha" htmlFor="ficha-notas" hint="Opcional. Aparece no topo para a oficina.">
          <Textarea {...fieldA11y('ficha-notas', undefined, true)} rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} />
        </Field>

        {ficha && !ficha.isPublished && (
          <Alert variant="info">
            Esta ficha é <strong>rascunho</strong>: nenhuma oficina a vê. Publique quando estiver boa o bastante para
            alguém confiar nela numa bancada.
          </Alert>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3">
        {ficha && (
          <Button variant="ghost" className="sm:mr-auto" onClick={() => setConfirmando(true)}>
            <Trash2 />
            Excluir
          </Button>
        )}
        <Button variant="secondary" loading={salvar.isPending} onClick={() => void gravar(false)}>
          Salvar rascunho
        </Button>
        <Button loading={salvar.isPending} onClick={() => void gravar(true)}>
          Publicar
        </Button>
      </div>

      {ficha && (
        <ConfirmDialog
          open={confirmando}
          onOpenChange={setConfirmando}
          destructive
          title={`Excluir a ficha do ${nomeDoCarro(ficha)}?`}
          description="A ficha some para todas as oficinas. Não dá para desfazer."
          confirmLabel="Excluir ficha"
          onConfirm={async () => {
            try {
              await excluir.mutateAsync(ficha.id);
              toast.success('Ficha excluída.');
              onSair();
            } catch (erro) {
              toast.error(errorMessage(erro));
            }
          }}
        />
      )}
    </Card>
  );
}
