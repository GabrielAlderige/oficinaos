import { CUSTOMER_SOURCE_LABELS, type Customer } from '@oficinaos/shared';
import { Car, History, MessageCircle, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { usePageCrumb } from '../../app/layouts/crumbs';
import { PlateBadge } from '../../components/plate-badge';
import { Button } from '../../components/ui/button';
import { Alert, Badge, Card, CardHeader, Skeleton } from '../../components/ui/display';
import { EmptyState } from '../../components/ui/list-parts';
import { ConfirmDialog } from '../../components/ui/overlays';
import { displayDocument, displayPhone, formatKm, whatsappUrl } from '../../lib/contact';
import { errorMessage } from '../../lib/errors';
import { formatDate } from '../../lib/format';
import { useCan } from '../../lib/session';
import { VehicleFormDialog } from '../vehicles/VehicleFormDialog';
import { useCustomer, useCustomerVehicles, useDeleteCustomer } from './api';
import { CustomerFormDialog } from './CustomerFormDialog';

export function CustomerPage() {
  const { id = '' } = useParams();
  const customer = useCustomer(id);
  usePageCrumb(customer.data?.name);

  if (customer.isPending) {
    return (
      <div className="space-y-4" aria-label="Carregando cliente">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (customer.isError) {
    return (
      <Alert variant="danger">
        {errorMessage(customer.error)}{' '}
        <Link to="/clientes" className="font-medium underline">
          Voltar para os clientes
        </Link>
      </Alert>
    );
  }
  return <CustomerDetail customer={customer.data} />;
}

function Info({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-3 py-1.5 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words">{children || <span className="text-muted">–</span>}</dd>
    </div>
  );
}

function CustomerDetail({ customer }: { customer: Customer }) {
  const navigate = useNavigate();
  const canWrite = useCan('customers:write');
  const canDelete = useCan('customers:delete');
  const canAddVehicle = useCan('vehicles:write');
  const vehicles = useCustomerVehicles(customer.id);
  const remove = useDeleteCustomer();
  const [editing, setEditing] = useState(false);
  const [addingVehicle, setAddingVehicle] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const whatsapp = whatsappUrl(customer.whatsapp);
  const a = customer.address;
  const address = [
    [a.street, a.number].filter(Boolean).join(', '),
    a.complement,
    a.district,
    [a.city, a.state].filter(Boolean).join(' - '),
    a.zip && a.zip.replace(/^(\d{5})(\d{3})$/, '$1-$2'),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{customer.name}</h1>
            {customer.type === 'PJ' && <Badge>Empresa</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted">Cliente desde {formatDate(customer.createdAt)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {whatsapp && (
            <Button asChild variant="secondary">
              <a href={whatsapp} target="_blank" rel="noopener noreferrer">
                <MessageCircle />
                WhatsApp
              </a>
            </Button>
          )}
          {canWrite && (
            <Button variant="secondary" onClick={() => setEditing(true)}>
              <Pencil />
              Editar
            </Button>
          )}
          {canDelete && (
            <Button variant="ghost" onClick={() => setConfirmDelete(true)} aria-label="Excluir cliente">
              <Trash2 />
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader
              title="Veículos"
              description={`${customer.vehicleCount} ${customer.vehicleCount === 1 ? 'veículo' : 'veículos'}`}
              action={
                canAddVehicle && (
                  <Button variant="secondary" size="sm" onClick={() => setAddingVehicle(true)}>
                    <Plus />
                    Adicionar veículo
                  </Button>
                )
              }
            />
            {vehicles.isPending ? (
              <div className="p-5">
                <Skeleton className="h-10 w-full" />
              </div>
            ) : vehicles.data?.length ? (
              <ul className="divide-y divide-border">
                {vehicles.data.map((v) => (
                  <li key={v.id}>
                    <Link to={`/veiculos/${v.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 hover:bg-surface-muted/60">
                      <PlateBadge plate={v.plate} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {v.make} {v.model} {v.version}
                        </span>
                        <span className="text-xs text-muted">{[v.yearManufacture && `${v.yearManufacture}/${v.yearModel ?? v.yearManufacture}`].filter(Boolean).join(' ')}</span>
                      </span>
                      {v.odometerKm !== null && <span className="text-sm text-muted tabular">{formatKm(v.odometerKm)}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                icon={Car}
                title="Nenhum veículo cadastrado"
                description="Cadastre o carro do cliente para abrir ordens de serviço e acompanhar a quilometragem."
                action={canAddVehicle && <Button onClick={() => setAddingVehicle(true)}>Adicionar veículo</Button>}
              />
            )}
          </Card>

          <Card>
            <CardHeader title="Histórico de atendimentos" />
            <EmptyState
              icon={History}
              title="Sem atendimentos por enquanto"
              description="As ordens de serviço, os orçamentos e os pagamentos deste cliente vão aparecer aqui."
            />
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Contato" />
            <dl className="px-5 py-3">
              {customer.contactMasked && (
                <Alert variant="info" className="mb-2">
                  O contato aparece parcial para o seu papel.
                </Alert>
              )}
              <Info label="WhatsApp">{displayPhone(customer.whatsapp)}</Info>
              <Info label="Telefone">{displayPhone(customer.phone)}</Info>
              <Info label="E-mail">{customer.email}</Info>
              <Info label={customer.type === 'PJ' ? 'CNPJ' : 'CPF'}>{displayDocument(customer.document)}</Info>
              {!customer.contactMasked && <Info label="Endereço">{address}</Info>}
              <Info label="Como conheceu">{customer.source && CUSTOMER_SOURCE_LABELS[customer.source]}</Info>
              <Info label="Lembretes">{customer.marketingOptIn ? 'Aceita receber pelo WhatsApp' : 'Não autorizou'}</Info>
            </dl>
          </Card>
          {customer.notes && (
            <Card>
              <CardHeader title="Observações" />
              <p className="px-5 py-4 text-sm whitespace-pre-line">{customer.notes}</p>
            </Card>
          )}
        </div>
      </div>

      <CustomerFormDialog open={editing} onOpenChange={setEditing} customer={customer} />
      <VehicleFormDialog
        open={addingVehicle}
        onOpenChange={setAddingVehicle}
        fixedCustomer={{ id: customer.id, name: customer.name }}
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        destructive
        title={`Excluir ${customer.name}?`}
        description={
          customer.vehicleCount
            ? `O cliente e ${customer.vehicleCount === 1 ? 'o veículo dele saem' : `os ${customer.vehicleCount} veículos dele saem`} das listas. O histórico de atendimentos continua guardado.`
            : 'O cliente sai das listas. O histórico de atendimentos continua guardado.'
        }
        confirmLabel="Excluir"
        onConfirm={async () => {
          try {
            await remove.mutateAsync(customer.id);
            toast.success(`${customer.name} foi excluído.`);
            navigate('/clientes', { replace: true });
          } catch (err) {
            toast.error(errorMessage(err));
          }
        }}
      />
    </>
  );
}
