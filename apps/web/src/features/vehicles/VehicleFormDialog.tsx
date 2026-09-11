import { zodResolver } from '@hookform/resolvers/zod';
import {
  canonicalPlate,
  FUEL_LABELS,
  FUELS,
  formatPlate,
  TRANSMISSION_LABELS,
  TRANSMISSIONS,
  vehicleFormSchema,
  type Vehicle,
  type VehicleForm,
  type VehicleInput,
} from '@oficinaos/shared';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Alert } from '../../components/ui/display';
import { Field, fieldA11y, Select } from '../../components/ui/field';
import { Input, Textarea } from '../../components/ui/input';
import { ConfirmDialog, Dialog, DialogContent, DialogFooter, DialogHeader } from '../../components/ui/overlays';
import { ApiError } from '../../lib/api-client';
import { COMMON_MAKES } from '../../lib/contact';
import { applyFieldErrors, errorMessage } from '../../lib/errors';
import { useDebouncedValue } from '../../lib/use-debounced-value';
import { CustomerSearchField, type PickedCustomer } from '../customers/CustomerSearchField';
import { useCreateVehicle, usePlateLookup, useUpdateVehicle } from './api';

const kmFormat = new Intl.NumberFormat('pt-BR');

function toFormValues(vehicle?: Vehicle, customerId = ''): VehicleForm {
  return {
    customerId: vehicle?.customer.id ?? customerId,
    plate: vehicle?.plate ? formatPlate(vehicle.plate) : '',
    make: vehicle?.make ?? '',
    model: vehicle?.model ?? '',
    version: vehicle?.version ?? '',
    engine: vehicle?.engine ?? '',
    color: vehicle?.color ?? '',
    yearManufacture: vehicle?.yearManufacture ? String(vehicle.yearManufacture) : '',
    yearModel: vehicle?.yearModel ? String(vehicle.yearModel) : '',
    fuel: vehicle?.fuel ?? '',
    transmission: vehicle?.transmission ?? '',
    vin: vehicle?.vin ?? '',
    odometerKm: vehicle?.odometerKm != null ? kmFormat.format(vehicle.odometerKm) : '',
    notes: vehicle?.notes ?? '',
  };
}

/**
 * Cadastro e edição de veículo. A placa é conferida enquanto a pessoa digita:
 * se o carro já existe na oficina, o formulário avisa antes de duplicar.
 */
export function VehicleFormDialog({ open, onOpenChange, vehicle, fixedCustomer, onSaved }: {
  open: boolean;
  onOpenChange(open: boolean): void;
  vehicle?: Vehicle;
  /** cadastro a partir da página do cliente: o dono já está escolhido */
  fixedCustomer?: PickedCustomer;
  onSaved?(vehicle: Vehicle): void;
}) {
  const create = useCreateVehicle();
  const update = useUpdateVehicle();
  const [customer, setCustomer] = useState<PickedCustomer | null>(fixedCustomer ?? null);
  const [pendingDecrease, setPendingDecrease] = useState<{ values: VehicleInput; message: string } | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(vehicleFormSchema), defaultValues: toFormValues(vehicle, fixedCustomer?.id) });

  // Reinicia SÓ quando o diálogo abre. Reiniciar a cada render do pai (que passa objetos novos)
  // apagava o que a pessoa digitou sempre que uma consulta em segundo plano atualizava a tela.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      reset(toFormValues(vehicle, fixedCustomer?.id));
      setCustomer(fixedCustomer ?? null);
    }
    wasOpen.current = open;
  }, [open, vehicle, fixedCustomer, reset]);

  const plate = useDebouncedValue(watch('plate'), 350);
  const lookup = usePlateLookup(plate);
  const clash = lookup.data?.find((v) => v.id !== vehicle?.id && canonicalPlate(v.plate ?? '') === canonicalPlate(plate));

  async function save(values: VehicleInput, confirmOdometerDecrease = false) {
    try {
      let saved: Vehicle;
      if (vehicle) {
        const { customerId: _owner, ...changes } = values;
        saved = await update.mutateAsync({ id: vehicle.id, body: { ...changes, confirmOdometerDecrease } });
        toast.success('Veículo atualizado.');
      } else {
        saved = await create.mutateAsync(values);
        toast.success(`${saved.make} ${saved.model} cadastrado.`);
      }
      onOpenChange(false);
      onSaved?.(saved);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'ODOMETER_DECREASE') {
        setPendingDecrease({ values, message: err.problem?.detail ?? '' });
      } else if (!applyFieldErrors(err, setError)) {
        setError('root', { message: errorMessage(err) });
      }
    }
  }

  const onSubmit = handleSubmit((values) => save(values));
  const e = errors;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <form onSubmit={onSubmit} noValidate>
            <DialogHeader
              title={vehicle ? 'Editar veículo' : 'Novo veículo'}
              description={vehicle ? undefined : 'Placa, marca e modelo bastam para começar. O resto dá para completar depois.'}
            />
            <div className="space-y-4">
              {e.root?.message && <Alert variant="danger">{e.root.message}</Alert>}

              {!vehicle && (
                <Field label="Cliente (dono)" htmlFor="v-customer" error={e.customerId?.message}>
                  {fixedCustomer ? (
                    <Input id="v-customer" value={fixedCustomer.name} readOnly disabled />
                  ) : (
                    <CustomerSearchField
                      id="v-customer"
                      value={customer}
                      invalid={Boolean(e.customerId)}
                      onChange={(picked) => {
                        setCustomer(picked);
                        setValue('customerId', picked?.id ?? '', { shouldValidate: Boolean(picked) });
                      }}
                    />
                  )}
                </Field>
              )}

              <div className="grid gap-4 sm:grid-cols-6">
                <Field label="Placa" htmlFor="v-plate" error={e.plate?.message} hint="Antiga ou Mercosul" className="sm:col-span-2">
                  <Input
                    {...fieldA11y('v-plate', e.plate?.message, true)}
                    className="font-mono uppercase"
                    placeholder="ABC1D23"
                    autoComplete="off"
                    autoFocus={Boolean(fixedCustomer || vehicle)}
                    {...register('plate')}
                  />
                </Field>
                <Field label="Marca" htmlFor="v-make" error={e.make?.message} className="sm:col-span-2">
                  <Input {...fieldA11y('v-make', e.make?.message)} list="vehicle-makes" autoComplete="off" {...register('make')} />
                  <datalist id="vehicle-makes">
                    {COMMON_MAKES.map((make) => (
                      <option key={make} value={make} />
                    ))}
                  </datalist>
                </Field>
                <Field label="Modelo" htmlFor="v-model" error={e.model?.message} className="sm:col-span-2">
                  <Input {...fieldA11y('v-model', e.model?.message)} placeholder="Ex.: Onix" autoComplete="off" {...register('model')} />
                </Field>
              </div>

              {clash && (
                <Alert variant="warning">
                  Esta placa já está cadastrada: {clash.make} {clash.model} de {clash.customer.name}.{' '}
                  <Link to={`/veiculos/${clash.id}`} className="font-medium underline" onClick={() => onOpenChange(false)}>
                    Abrir o veículo
                  </Link>
                </Alert>
              )}

              <div className="grid gap-4 sm:grid-cols-6">
                <Field label="Versão" htmlFor="v-version" className="sm:col-span-3">
                  <Input id="v-version" placeholder="Ex.: LT 1.0 Turbo" {...register('version')} />
                </Field>
                <Field label="Motor" htmlFor="v-engine" className="sm:col-span-3">
                  <Input id="v-engine" placeholder="Ex.: 1.0 12V" {...register('engine')} />
                </Field>
                <Field label="Ano fabricação" htmlFor="v-year-made" error={e.yearManufacture?.message} className="sm:col-span-2">
                  <Input {...fieldA11y('v-year-made', e.yearManufacture?.message)} inputMode="numeric" maxLength={4} {...register('yearManufacture')} />
                </Field>
                <Field label="Ano modelo" htmlFor="v-year-model" error={e.yearModel?.message} className="sm:col-span-2">
                  <Input {...fieldA11y('v-year-model', e.yearModel?.message)} inputMode="numeric" maxLength={4} {...register('yearModel')} />
                </Field>
                <Field label="Quilometragem" htmlFor="v-km" error={e.odometerKm?.message} className="sm:col-span-2">
                  <Input {...fieldA11y('v-km', e.odometerKm?.message)} inputMode="numeric" placeholder="Ex.: 58.000" {...register('odometerKm')} />
                </Field>
                <Field label="Combustível" htmlFor="v-fuel" className="sm:col-span-2">
                  <Select id="v-fuel" {...register('fuel')}>
                    <option value="">Não informado</option>
                    {FUELS.map((fuel) => (
                      <option key={fuel} value={fuel}>
                        {FUEL_LABELS[fuel]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Câmbio" htmlFor="v-transmission" className="sm:col-span-2">
                  <Select id="v-transmission" {...register('transmission')}>
                    <option value="">Não informado</option>
                    {TRANSMISSIONS.map((t) => (
                      <option key={t} value={t}>
                        {TRANSMISSION_LABELS[t]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Cor" htmlFor="v-color" className="sm:col-span-2">
                  <Input id="v-color" {...register('color')} />
                </Field>
                <Field label="Chassi" htmlFor="v-vin" error={e.vin?.message} className="sm:col-span-6">
                  <Input {...fieldA11y('v-vin', e.vin?.message)} className="font-mono uppercase" maxLength={17} {...register('vin')} />
                </Field>
                <Field label="Observações" htmlFor="v-notes" className="sm:col-span-6">
                  <Textarea id="v-notes" rows={2} {...register('notes')} />
                </Field>
              </div>
            </div>
            <DialogFooter>
              <Button variant="secondary" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" loading={isSubmitting}>
                {vehicle ? 'Salvar' : 'Cadastrar veículo'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={pendingDecrease !== null}
        onOpenChange={(isOpen) => !isOpen && setPendingDecrease(null)}
        title="Quilometragem menor que a anterior"
        description={`${pendingDecrease?.message ?? ''} Isso só acontece se houve erro de digitação antes ou troca do painel.`}
        confirmLabel="Corrigir mesmo assim"
        onConfirm={async () => {
          if (pendingDecrease) await save(pendingDecrease.values, true);
        }}
      />
    </>
  );
}
