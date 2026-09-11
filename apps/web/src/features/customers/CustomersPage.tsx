import { Plus, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { PlateBadge } from '../../components/plate-badge';
import { Button } from '../../components/ui/button';
import { Alert, Badge, Card, PageHeader, Skeleton } from '../../components/ui/display';
import { EmptyState, Pagination, SearchInput } from '../../components/ui/list-parts';
import { displayDocument, displayPhone } from '../../lib/contact';
import { errorMessage } from '../../lib/errors';
import { formatDate } from '../../lib/format';
import { useCan } from '../../lib/session';
import { useDebouncedValue } from '../../lib/use-debounced-value';
import { useCustomers } from './api';
import { CustomerFormDialog } from './CustomerFormDialog';

export function CustomersPage() {
  const canWrite = useCan('customers:write');
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDebouncedValue(search.trim(), 300);
  const [creating, setCreating] = useState(false);

  // a busca fica na URL: F5 e voltar mantêm o que a pessoa estava procurando
  useEffect(() => {
    if (q === (params.get('q') ?? '')) return;
    setParams(q ? { q } : {}, { replace: true });
  }, [q, params, setParams]);

  const customers = useCustomers({ q, page });
  const data = customers.data;

  return (
    <>
      <PageHeader
        title="Clientes"
        description="Busque por nome, telefone, CPF/CNPJ ou placa do carro."
        actions={
          canWrite && (
            <Button onClick={() => setCreating(true)}>
              <Plus />
              Novo cliente
            </Button>
          )
        }
      />
      <Card>
        <div className="border-b border-border p-3">
          <SearchInput value={search} onChange={setSearch} placeholder="Nome, telefone, documento ou placa" label="Buscar clientes" autoFocus />
        </div>

        {customers.isPending ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : customers.isError ? (
          <div className="p-5">
            <Alert variant="danger">{errorMessage(customers.error)}</Alert>
          </div>
        ) : !data?.data.length ? (
          q ? (
            <EmptyState icon={Users} title={`Nenhum cliente encontrado para “${q}”`} description="Confira a grafia ou busque pela placa do carro." />
          ) : (
            <EmptyState
              icon={Users}
              title="Nenhum cliente ainda"
              description="Cadastre o primeiro cliente e os carros dele. Depois é só buscar pela placa."
              action={canWrite && <Button onClick={() => setCreating(true)}>Cadastrar o primeiro cliente</Button>}
            />
          )
        ) : (
          <>
            <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1.4fr)_6.5rem] gap-4 border-b border-border px-5 py-2 text-xs font-medium text-muted md:grid">
              <span>Cliente</span>
              <span>WhatsApp</span>
              <span>Veículos</span>
              <span className="text-right">Desde</span>
            </div>
            <ul className={customers.isPlaceholderData ? 'divide-y divide-border opacity-60' : 'divide-y divide-border'}>
              {data.data.map((customer) => (
                <li key={customer.id}>
                  <Link
                    to={`/clientes/${customer.id}`}
                    className="grid gap-x-4 gap-y-1 px-5 py-3 hover:bg-surface-muted/60 md:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1.4fr)_6.5rem] md:items-center"
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{customer.name}</span>
                        {customer.type === 'PJ' && <Badge>Empresa</Badge>}
                      </span>
                      {customer.document && <span className="block truncate text-xs text-muted">{displayDocument(customer.document)}</span>}
                    </span>
                    <span className="text-sm text-muted tabular">{displayPhone(customer.whatsapp ?? customer.phone) ?? '–'}</span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      {customer.plates.map((plate) => (
                        <PlateBadge key={plate} plate={plate} size="sm" />
                      ))}
                      {customer.vehicleCount > customer.plates.length && (
                        <span className="text-xs text-muted">+{customer.vehicleCount - customer.plates.length}</span>
                      )}
                      {customer.vehicleCount === 0 && <span className="text-xs text-muted">Nenhum</span>}
                    </span>
                    <span className="text-xs text-muted md:text-right">{formatDate(customer.createdAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
            <Pagination meta={data.meta} onPageChange={(next) => setParams({ ...(q ? { q } : {}), page: String(next) })} />
          </>
        )}
      </Card>

      <CustomerFormDialog open={creating} onOpenChange={setCreating} onSaved={(c) => navigate(`/clientes/${c.id}`)} />
    </>
  );
}
