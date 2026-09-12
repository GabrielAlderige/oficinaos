import type { WorkOrderItemInput } from '@oficinaos/shared';
import { ArrowRight, Car, Check, Plus, Trash2, User } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { PlateBadge } from '../../components/plate-badge';
import { Button } from '../../components/ui/button';
import { Alert, Card, PageHeader, Skeleton } from '../../components/ui/display';
import { Field, fieldA11y } from '../../components/ui/field';
import { AdornedInput, Textarea } from '../../components/ui/input';
import { cn } from '../../lib/cn';
import { errorMessage } from '../../lib/errors';
import { useCan } from '../../lib/session';
import { CustomerFormDialog } from '../customers/CustomerFormDialog';
import { CustomerSearchField, type PickedCustomer } from '../customers/CustomerSearchField';
import { useVehicles } from '../vehicles/api';
import { VehicleFormDialog } from '../vehicles/VehicleFormDialog';
import { useCreateWorkOrder } from './api';
import { ItemPicker } from './ItemPicker';

interface PickedItem {
  label: string;
  input: WorkOrderItemInput;
}

function Step({ number, title, done, children }: { number: number; title: string; done?: boolean; children: ReactNode }) {
  return (
    <section className="border-b border-border px-5 py-5 last:border-b-0">
      <h2 className="mb-3 flex items-center gap-2.5 text-sm font-semibold">
        <span
          className={cn(
            'grid size-6 shrink-0 place-items-center rounded-full text-xs',
            done ? 'bg-success text-white dark:text-[#121211]' : 'bg-surface-muted text-muted',
          )}
          aria-hidden="true"
        >
          {done ? <Check className="size-3.5" /> : number}
        </span>
        {title}
      </h2>
      <div className="pl-8.5">{children}</div>
    </section>
  );
}

/**
 * Nova OS numa tela só (ARCHITECTURE §8.4). A meta é abrir a OS em poucos
 * toques a partir da placa: achou o cliente, os carros dele viram cartões, e o
 * resto é opcional — orçar depois do diagnóstico é o caminho normal da oficina.
 */
export function NewWorkOrderPage() {
  const canWrite = useCan('work_orders:write');
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const create = useCreateWorkOrder();

  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [vehicleId, setVehicleId] = useState<string | null>(params.get('veiculo'));
  const [complaint, setComplaint] = useState('');
  const [odometer, setOdometer] = useState('');
  const [items, setItems] = useState<PickedItem[]>([]);
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const [creatingVehicle, setCreatingVehicle] = useState(false);
  const [picking, setPicking] = useState(false);

  const vehicles = useVehicles({ q: '', page: 1, customerId: customer?.id });
  const list = customer ? (vehicles.data?.data ?? []) : [];
  const odometerKm = odometer.replace(/\D/g, '') ? Number(odometer.replace(/\D/g, '')) : null;

  if (!canWrite) return <Alert variant="danger">Seu acesso não permite abrir ordens de serviço.</Alert>;

  async function open() {
    if (!customer || !vehicleId) return;
    try {
      const order = await create.mutateAsync({
        customerId: customer.id,
        vehicleId,
        complaint,
        odometerKm,
        items: items.map((item) => item.input),
      });
      toast.success(`OS ${order.number} aberta.`);
      navigate(`/ordens/${order.number}`, { replace: true });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <>
      <PageHeader title="Nova ordem de serviço" description="Comece pela placa ou pelo nome do cliente." />

      <Card>
        <Step number={1} title="Cliente" done={Boolean(customer)}>
          <div className="max-w-xl space-y-2">
            <CustomerSearchField
              id="os-customer"
              value={customer}
              onChange={(picked) => {
                setCustomer(picked);
                setVehicleId(null);
              }}
            />
            {!customer && (
              <Button variant="secondary" size="sm" onClick={() => setCreatingCustomer(true)}>
                <Plus />
                Cadastrar cliente novo
              </Button>
            )}
          </div>
        </Step>

        {customer && (
          <Step number={2} title="Veículo" done={Boolean(vehicleId)}>
            {vehicles.isPending ? (
              <Skeleton className="h-16 w-full max-w-xl" />
            ) : (
              <div className="flex flex-wrap gap-2">
                {list.map((vehicle) => (
                  <button
                    key={vehicle.id}
                    type="button"
                    onClick={() => setVehicleId(vehicle.id)}
                    aria-pressed={vehicleId === vehicle.id}
                    className={cn(
                      'flex min-w-56 items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
                      vehicleId === vehicle.id
                        ? 'border-accent bg-accent-soft dark:border-accent-bright'
                        : 'border-border hover:bg-surface-muted',
                    )}
                  >
                    <PlateBadge plate={vehicle.plate} size="sm" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {vehicle.make} {vehicle.model}
                      </span>
                      <span className="block text-xs text-muted">
                        {vehicle.yearManufacture ? `${vehicle.yearManufacture}/${vehicle.yearModel ?? vehicle.yearManufacture}` : 'Ano não informado'}
                      </span>
                    </span>
                  </button>
                ))}
                <Button variant="secondary" onClick={() => setCreatingVehicle(true)}>
                  <Car />
                  {list.length ? 'Outro veículo' : 'Cadastrar o veículo'}
                </Button>
              </div>
            )}
          </Step>
        )}

        {customer && vehicleId && (
          <>
            <Step number={3} title="O que o cliente relatou" done={complaint.trim().length > 0}>
              <div className="grid max-w-2xl gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
                <Field label="Relato" htmlFor="os-complaint" hint="Com as palavras do cliente: “barulho ao frear”.">
                  <Textarea
                    {...fieldA11y('os-complaint', undefined, true)}
                    rows={2}
                    value={complaint}
                    onChange={(event) => setComplaint(event.target.value)}
                    placeholder="Ex.: barulho ao frear e volante trepidando"
                  />
                </Field>
                <Field label="Quilometragem" htmlFor="os-km">
                  <AdornedInput
                    trailing="km"
                    {...fieldA11y('os-km')}
                    inputMode="numeric"
                    value={odometer}
                    onChange={(event) => setOdometer(event.target.value)}
                    placeholder="82.000"
                  />
                </Field>
              </div>
            </Step>

            <Step number={4} title="Serviços e peças (opcional)" done={items.length > 0}>
              <div className="max-w-2xl space-y-3">
                {items.length > 0 && (
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {items.map((item, index) => (
                      <li key={`${item.label}-${index}`} className="flex items-center justify-between gap-3 px-3 py-2">
                        <span className="truncate text-sm">{item.label}</span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          aria-label={`Remover ${item.label}`}
                          onClick={() => setItems((current) => current.filter((_, i) => i !== index))}
                        >
                          <Trash2 />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
                <Button variant="secondary" onClick={() => setPicking(true)}>
                  <Plus />
                  Adicionar item
                </Button>
                <p className="text-xs text-muted">
                  Dá para abrir a OS sem itens e orçar depois do diagnóstico — é o caminho mais comum.
                </p>
              </div>
            </Step>
          </>
        )}

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border px-5 py-4">
          {customer && vehicleId && (
            <span className="mr-auto text-sm text-muted">
              <User className="mr-1.5 inline size-3.5" aria-hidden="true" />
              {customer.name}
              {items.length > 0 && ` · ${items.length} ${items.length === 1 ? 'item' : 'itens'}`}
            </span>
          )}
          <Button variant="secondary" onClick={() => navigate('/ordens')}>
            Cancelar
          </Button>
          <Button disabled={!customer || !vehicleId} loading={create.isPending} onClick={() => void open()}>
            Abrir OS
            <ArrowRight />
          </Button>
        </div>
      </Card>

      <CustomerFormDialog
        open={creatingCustomer}
        onOpenChange={setCreatingCustomer}
        onSaved={(saved) => setCustomer({ id: saved.id, name: saved.name })}
      />
      {customer && (
        <VehicleFormDialog
          open={creatingVehicle}
          onOpenChange={setCreatingVehicle}
          fixedCustomer={{ id: customer.id, name: customer.name }}
          onSaved={(saved) => setVehicleId(saved.id)}
        />
      )}
      <ItemPicker
        open={picking}
        onOpenChange={setPicking}
        onPick={(input, label) => setItems((current) => [...current, { input, label }])}
      />
    </>
  );
}
