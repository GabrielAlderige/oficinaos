import { Plus, Star, Truck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Button } from '../../components/ui/button';
import { Alert, Card, PageHeader, Skeleton } from '../../components/ui/display';
import { EmptyState, Pagination, SearchInput } from '../../components/ui/list-parts';
import { cn } from '../../lib/cn';
import { displayDocument, displayPhone } from '../../lib/contact';
import { errorMessage } from '../../lib/errors';
import { useCan } from '../../lib/session';
import { useDebouncedValue } from '../../lib/use-debounced-value';
import { usePartCategories } from '../catalog/api';
import { useSuppliers } from './api';
import { SupplierFormDialog } from './SupplierFormDialog';

/** "2 d", "no dia" ou "–": o prazo cabe numa coluna estreita. */
function prazoCurto(dias: number | null): string {
  if (dias === null) return '–';
  return dias === 0 ? 'no dia' : `${dias} d`;
}

/**
 * Lista de fornecedores. A busca e o filtro de categoria ficam na URL (F5 e
 * voltar mantêm), e o filtro usa as categorias de peça da oficina — é a mesma
 * pergunta que a pessoa faz no balcão: "quem vende freio?".
 */
export function SuppliersPage() {
  const podeEscrever = useCan('suppliers:write');
  const podeVerCatalogo = useCan('catalog:read');
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const categoria = params.get('categoria') ?? '';
  const [busca, setBusca] = useState(params.get('q') ?? '');
  const q = useDebouncedValue(busca.trim(), 300);
  const [criando, setCriando] = useState(false);
  const categorias = usePartCategories();

  // a busca digitada vai para a URL; trocar filtro volta para a primeira página
  useEffect(() => {
    if (q === (params.get('q') ?? '')) return;
    const proximo = new URLSearchParams(params);
    if (q) proximo.set('q', q);
    else proximo.delete('q');
    proximo.delete('page');
    setParams(proximo, { replace: true });
  }, [q, params, setParams]);

  const trocarCategoria = (valor: string) => {
    const proximo = new URLSearchParams(params);
    if (valor) proximo.set('categoria', valor);
    else proximo.delete('categoria');
    proximo.delete('page');
    setParams(proximo, { replace: true });
  };

  // os botões vêm das categorias de peça; mas o filtro pode chegar por link com
  // uma categoria só de fornecedor ("Borracharia") — aí ela entra na fileira,
  // marcada, senão não haveria como tirar o filtro
  const deCatalogo = podeVerCatalogo ? (categorias.data ?? []).map((item) => ({ name: item.name })) : [];
  const opcoesDeFiltro =
    categoria && !deCatalogo.some((item) => item.name.toLowerCase() === categoria.toLowerCase())
      ? [{ name: categoria }, ...deCatalogo]
      : deCatalogo;

  const fornecedores = useSuppliers({ q, category: categoria || undefined, page });
  const dados = fornecedores.data;
  const filtrando = Boolean(q || categoria);

  return (
    <>
      <PageHeader
        title="Fornecedores"
        description="De quem a oficina compra. Busque por nome, vendedor, CNPJ ou telefone."
        actions={
          podeEscrever && (
            <Button onClick={() => setCriando(true)}>
              <Plus />
              Novo fornecedor
            </Button>
          )
        }
      />
      <Card>
        <div className="space-y-3 border-b border-border p-3">
          <SearchInput
            value={busca}
            onChange={setBusca}
            placeholder="Nome, vendedor, CNPJ ou telefone"
            label="Buscar fornecedores"
            autoFocus
          />
          {(opcoesDeFiltro.length > 0) && (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por categoria">
              {opcoesDeFiltro.map((item) => {
                const ativa = categoria.toLowerCase() === item.name.toLowerCase();
                return (
                  <button
                    key={item.name}
                    type="button"
                    aria-pressed={ativa}
                    onClick={() => trocarCategoria(ativa ? '' : item.name)}
                    className={cn(
                      'rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                      ativa
                        ? 'border-accent-bright bg-accent-soft font-medium text-foreground'
                        : 'border-border text-muted hover:text-foreground',
                    )}
                  >
                    {item.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {fornecedores.isPending ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : fornecedores.isError ? (
          <div className="p-5">
            <Alert variant="danger">{errorMessage(fornecedores.error)}</Alert>
          </div>
        ) : !dados?.data.length ? (
          filtrando ? (
            <EmptyState
              icon={Truck}
              title="Nenhum fornecedor com esse filtro"
              description={
                categoria ? `Ninguém cadastrado atende “${categoria}”.` : 'Confira a grafia ou busque pelo telefone.'
              }
            />
          ) : (
            <EmptyState
              icon={Truck}
              title="Nenhum fornecedor ainda"
              description="Cadastre as autopeças e distribuidoras de quem a oficina compra. É o primeiro passo para pedir cotação pelo WhatsApp."
              action={podeEscrever && <Button onClick={() => setCriando(true)}>Cadastrar o primeiro fornecedor</Button>}
            />
          )
        ) : (
          <>
            <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1.6fr)_5rem] gap-4 border-b border-border px-5 py-2 text-xs font-medium text-muted md:grid">
              <span>Fornecedor</span>
              <span>WhatsApp</span>
              <span>Categorias</span>
              <span className="text-right">Prazo</span>
            </div>
            <ul className={cn('divide-y divide-border', fornecedores.isPlaceholderData && 'opacity-60')}>
              {dados.data.map((fornecedor) => (
                <li key={fornecedor.id}>
                  <Link
                    to={`/fornecedores/${fornecedor.id}`}
                    className="grid gap-x-4 gap-y-1 px-5 py-3 hover:bg-surface-muted/60 md:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1.6fr)_5rem] md:items-center"
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{fornecedor.name}</span>
                        {fornecedor.rating !== null && (
                          <span
                            className="inline-flex shrink-0 items-center gap-0.5 text-xs text-muted"
                            aria-label={`Nota ${fornecedor.rating} de 5`}
                          >
                            <Star className="size-3 fill-warning text-warning" aria-hidden="true" />
                            {fornecedor.rating}
                          </span>
                        )}
                      </span>
                      {(fornecedor.contactName || fornecedor.document) && (
                        <span className="block truncate text-xs text-muted">
                          {[fornecedor.contactName, displayDocument(fornecedor.document)].filter(Boolean).join(' · ')}
                        </span>
                      )}
                    </span>
                    <span className="text-sm text-muted tabular">
                      {displayPhone(fornecedor.whatsapp ?? fornecedor.phone) ?? '–'}
                    </span>
                    <span className="flex flex-wrap gap-1">
                      {fornecedor.categories.slice(0, 3).map((item) => (
                        <span key={item} className="rounded bg-surface-muted px-1.5 py-0.5 text-xs">
                          {item}
                        </span>
                      ))}
                      {fornecedor.categories.length > 3 && (
                        <span className="text-xs text-muted">+{fornecedor.categories.length - 3}</span>
                      )}
                      {!fornecedor.categories.length && <span className="text-xs text-muted">–</span>}
                    </span>
                    {/* no celular o cabeçalho "Prazo" some: "2 d" sozinho não quer dizer nada */}
                    <span className="text-sm text-muted md:text-right">
                      {fornecedor.leadTimeDays !== null && <span className="md:hidden">Entrega em </span>}
                      {prazoCurto(fornecedor.leadTimeDays)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <Pagination
              meta={dados.meta}
              onPageChange={(proxima) => {
                const proximo = new URLSearchParams(params);
                proximo.set('page', String(proxima));
                setParams(proximo);
              }}
            />
          </>
        )}
      </Card>

      <SupplierFormDialog
        open={criando}
        onOpenChange={setCriando}
        onSaved={(fornecedor) => navigate(`/fornecedores/${fornecedor.id}`)}
      />
    </>
  );
}
