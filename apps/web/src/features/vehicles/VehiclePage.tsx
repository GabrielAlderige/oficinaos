import {
  FUEL_LABELS,
  formatPlate,
  ODOMETER_SOURCE_LABELS,
  TRANSMISSION_LABELS,
  type Vehicle,
} from '@oficinaos/shared';
import { ArrowLeftRight, Gauge, History, MessageCircle, Pencil, Trash2 } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { usePageCrumb } from '../../app/layouts/crumbs';
import { PlateBadge } from '../../components/plate-badge';
import { Button } from '../../components/ui/button';
import { Alert, Card, CardHeader, Skeleton } from '../../components/ui/display';
import { Input } from '../../components/ui/input';
import { EmptyState } from '../../components/ui/list-parts';
import { ConfirmDialog, Dialog, DialogContent, DialogFooter, DialogHeader } from '../../components/ui/overlays';
import { ApiError } from '../../lib/api-client';
import { displayPhone, formatKm, whatsappUrl } from '../../lib/contact';
import { errorMessage } from '../../lib/errors';
import { formatDate, formatRelative } from '../../lib/format';
import { useCan } from '../../lib/session';
import { CustomerSearchField, type PickedCustomer } from '../customers/CustomerSearchField';
import { useDeleteVehicle, useOdometerReadings, useTransferVehicle, useUpdateVehicle, useVehicle } from './api';
import { VehicleFormDialog } from './VehicleFormDialog';

export function VehiclePage() {
  const { id = '' } = useParams();
  const vehicle = useVehicle(id);
  usePageCrumb(vehicle.data ? (vehicle.data.plate ? formatPlate(vehicle.data.plate) : vehicle.data.model) : undefined);

  if (vehicle.isPending) {
    return (
      <div className="space-y-4" aria-label="Carregando veículo">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }
  if (vehicle.isError) {
    return (
      <Alert variant="danger">
        {errorMessage(vehicle.error)}{' '}
        <Link to="/veiculos" className="font-medium underline">
          Voltar para os veículos
        </Link>
      </Alert>
    );
  }
  return <VehicleDetail vehicle={vehicle.data} />;
}

function Info({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-3 py-1.5 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words">{children || <span className="text-muted">–</span>}</dd>
    </div>
  );
}

function VehicleDetail({ vehicle }: { vehicle: Vehicle }) {
  const navigate = useNavigate();
  const canWrite = useCan('vehicles:write');
  const canDelete = useCan('vehicles:delete');
  const remove = useDeleteVehicle();
  const [editing, setEditing] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const whatsapp = whatsappUrl(vehicle.customer.whatsapp);
  const years = vehicle.yearManufacture ? `${vehicle.yearManufacture}/${vehicle.yearModel ?? vehicle.yearManufacture}` : null;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <PlateBadge plate={vehicle.plate} size="lg" />
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight">
              {vehicle.make} {vehicle.model}
            </h1>
            <p className="text-sm text-muted">{[vehicle.version, years].filter(Boolean).join(' · ') || 'Versão e ano não informados'}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canWrite && (
            <>
              <Button variant="secondary" onClick={() => setEditing(true)}>
                <Pencil />
                Editar
              </Button>
              <Button variant="secondary" onClick={() => setTransferring(true)}>
                <ArrowLeftRight />
                Trocar dono
              </Button>
            </>
          )}
          {canDelete && (
            <Button variant="ghost" onClick={() => setConfirmDelete(true)} aria-label="Excluir veículo">
              <Trash2 />
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Dados do veículo" />
            <dl className="px-5 py-3">
              <Info label="Placa">{vehicle.plate && formatPlate(vehicle.plate)}</Info>
              <Info label="Marca e modelo">{`${vehicle.make} ${vehicle.model}`}</Info>
              <Info label="Versão">{vehicle.version}</Info>
              <Info label="Motor">{vehicle.engine}</Info>
              <Info label="Ano">{years}</Info>
              <Info label="Combustível">{vehicle.fuel && FUEL_LABELS[vehicle.fuel]}</Info>
              <Info label="Câmbio">{vehicle.transmission && TRANSMISSION_LABELS[vehicle.transmission]}</Info>
              <Info label="Cor">{vehicle.color}</Info>
              <Info label="Chassi">{vehicle.vin && <span className="font-mono">{vehicle.vin}</span>}</Info>
              <Info label="Observações">{vehicle.notes}</Info>
            </dl>
          </Card>
          <Card>
            <CardHeader title="Histórico de serviços" />
            <EmptyState
              icon={History}
              title="Nenhum serviço registrado"
              description="Os serviços, as peças trocadas e a quilometragem de cada visita vão aparecer aqui a partir da primeira ordem de serviço."
            />
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Dono" />
            <div className="flex items-center justify-between gap-3 px-5 py-4">
              <div className="min-w-0">
                <Link to={`/clientes/${vehicle.customer.id}`} className="block truncate font-medium hover:underline">
                  {vehicle.customer.name}
                </Link>
                <span className="text-sm text-muted tabular">{displayPhone(vehicle.customer.whatsapp) ?? 'Sem WhatsApp'}</span>
              </div>
              {whatsapp && (
                <Button asChild variant="secondary" size="sm">
                  <a href={whatsapp} target="_blank" rel="noopener noreferrer">
                    <MessageCircle />
                    WhatsApp
                  </a>
                </Button>
              )}
            </div>
          </Card>
          <OdometerCard vehicle={vehicle} canWrite={canWrite} />
        </div>
      </div>

      <VehicleFormDialog open={editing} onOpenChange={setEditing} vehicle={vehicle} />
      <TransferDialog open={transferring} onOpenChange={setTransferring} vehicle={vehicle} />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        destructive
        title="Excluir este veículo?"
        description="Ele sai das listas e a placa fica livre para outro cadastro. O histórico de atendimentos continua guardado."
        confirmLabel="Excluir"
        onConfirm={async () => {
          try {
            await remove.mutateAsync(vehicle.id);
            toast.success('Veículo excluído.');
            navigate(`/clientes/${vehicle.customer.id}`, { replace: true });
          } catch (err) {
            toast.error(errorMessage(err));
          }
        }}
      />
    </>
  );
}

/** Quilometragem atual + registro rápido de uma leitura nova (com confirmação se diminuir). */
function OdometerCard({ vehicle, canWrite }: { vehicle: Vehicle; canWrite: boolean }) {
  const readings = useOdometerReadings(vehicle.id);
  const update = useUpdateVehicle();
  const [km, setKm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [decrease, setDecrease] = useState<{ km: number; message: string } | null>(null);

  async function register(value: number, confirmOdometerDecrease = false) {
    setError(null);
    try {
      await update.mutateAsync({ id: vehicle.id, body: { odometerKm: value, confirmOdometerDecrease } });
      toast.success(`Quilometragem registrada: ${formatKm(value)}.`);
      setKm('');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'ODOMETER_DECREASE') setDecrease({ km: value, message: err.problem?.detail ?? '' });
      else setError(errorMessage(err));
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const value = Number(km.replace(/\D/g, ''));
    if (!km.trim() || !Number.isFinite(value)) {
      setError('Informe a quilometragem do painel.');
      return;
    }
    void register(value);
  }

  return (
    <Card>
      <CardHeader title="Quilometragem" />
      <div className="px-5 py-4">
        {vehicle.odometerKm !== null ? (
          <>
            <p className="text-2xl font-semibold tabular">{formatKm(vehicle.odometerKm)}</p>
            {vehicle.odometerUpdatedAt && <p className="text-xs text-muted">atualizada {formatRelative(vehicle.odometerUpdatedAt)}</p>}
          </>
        ) : (
          <p className="text-sm text-muted">Nenhuma leitura registrada.</p>
        )}
        {canWrite && (
          <form onSubmit={submit} className="mt-4 flex gap-2" noValidate>
            <Input
              aria-label="Nova quilometragem"
              inputMode="numeric"
              placeholder="Km do painel"
              value={km}
              onChange={(e) => setKm(e.target.value)}
              aria-invalid={error ? true : undefined}
            />
            <Button type="submit" variant="secondary" loading={update.isPending}>
              <Gauge />
              Registrar
            </Button>
          </form>
        )}
        {error && (
          <p role="alert" className="mt-1.5 text-xs text-danger">
            {error}
          </p>
        )}
      </div>
      {readings.data && readings.data.length > 0 && (
        <ul className="divide-y divide-border border-t border-border">
          {readings.data.slice(0, 6).map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 px-5 py-2 text-sm">
              <span className="shrink-0 whitespace-nowrap tabular">{formatKm(r.km)}</span>
              <span className="text-right text-xs text-muted">
                {formatDate(r.recordedAt)} · {ODOMETER_SOURCE_LABELS[r.source]}
                {r.recordedByName && ` · ${r.recordedByName}`}
              </span>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={decrease !== null}
        onOpenChange={(open) => !open && setDecrease(null)}
        title="Quilometragem menor que a anterior"
        description={`${decrease?.message ?? ''} Isso só acontece se houve erro de digitação antes ou troca do painel.`}
        confirmLabel="Corrigir mesmo assim"
        onConfirm={async () => {
          if (decrease) await register(decrease.km, true);
        }}
      />
    </Card>
  );
}

function TransferDialog({ open, onOpenChange, vehicle }: { open: boolean; onOpenChange(open: boolean): void; vehicle: Vehicle }) {
  const transfer = useTransferVehicle();
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);

  async function confirm() {
    if (!customer) return;
    try {
      await transfer.mutateAsync({ id: vehicle.id, customerId: customer.id });
      toast.success(`O veículo agora é de ${customer.name}.`);
      setCustomer(null);
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) setCustomer(null);
        onOpenChange(isOpen);
      }}
    >
      <DialogContent>
        <DialogHeader
          title="Trocar o dono do veículo"
          description={`Hoje o carro é de ${vehicle.customer.name}. Os atendimentos antigos continuam no nome de quem pagou.`}
        />
        <CustomerSearchField id="transfer-customer" value={customer} onChange={setCustomer} />
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button disabled={!customer || customer.id === vehicle.customer.id} loading={transfer.isPending} onClick={() => void confirm()}>
            Transferir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
