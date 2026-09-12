import {
  CHECKLIST_STATE_LABELS,
  CHECKLIST_STATES,
  DAMAGE_KIND_LABELS,
  DAMAGE_KINDS,
  DAMAGE_ZONE_LABELS,
  DAMAGE_ZONES,
  DEFAULT_ACCESSORIES,
  DEFAULT_CHECKIN_CHECKLIST,
  FUEL_LEVEL_LABELS,
  type ChecklistState,
  type DamageKind,
  type DamageZone,
  type WorkOrder,
} from '@oficinaos/shared';
import { Camera, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ApiError } from '../../lib/api-client';
import { Button } from '../../components/ui/button';
import { Alert } from '../../components/ui/display';
import { Field, fieldA11y, Select } from '../../components/ui/field';
import { AdornedInput, Input, Textarea } from '../../components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '../../components/ui/overlays';
import { cn } from '../../lib/cn';
import { errorMessage } from '../../lib/errors';
import { compressImage, formatBytes } from '../../lib/image';
import { useAttachments, useCreateInspection, useUploadFile } from './api';

interface Damage {
  zone: DamageZone;
  kind: DamageKind;
  note: string;
}

const STATE_STYLES: Record<ChecklistState, string> = {
  OK: 'bg-success-soft text-success',
  ISSUE: 'bg-danger-soft text-danger',
  NA: 'bg-surface-muted text-muted',
};

/**
 * Check-in: o que o carro era quando entrou. É o que evita a discussão na
 * entrega ("esse risco já estava aí"), então a foto importa tanto quanto o
 * checklist — e ela é comprimida no aparelho antes de subir.
 */
export function CheckInDialog({ order, open, onOpenChange }: {
  order: WorkOrder;
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <CheckInBody order={order} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function CheckInBody({ order, onDone }: { order: WorkOrder; onDone(): void }) {
  const create = useCreateInspection(order.id, order.number);
  const upload = useUploadFile(order.id);
  const attachments = useAttachments(order.id);

  const [states, setStates] = useState<Record<string, ChecklistState>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [fuelLevel, setFuelLevel] = useState('4');
  const [odometer, setOdometer] = useState(order.odometerKm ? String(order.odometerKm) : '');
  const [accessories, setAccessories] = useState<string[]>([]);
  const [damages, setDamages] = useState<Damage[]>([]);
  const [generalNotes, setGeneralNotes] = useState('');
  const [confirmDecrease, setConfirmDecrease] = useState(false);
  const [decreaseWarning, setDecreaseWarning] = useState<string | null>(null);

  const odometerKm = odometer.replace(/\D/g, '') ? Number(odometer.replace(/\D/g, '')) : null;

  async function addPhotos(files: FileList | null) {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      try {
        await upload.mutateAsync({ file: await compressImage(file) });
      } catch (err) {
        toast.error(errorMessage(err));
      }
    }
  }

  async function submit() {
    try {
      await create.mutateAsync({
        type: 'CHECK_IN',
        odometerKm,
        fuelLevel: Number(fuelLevel),
        checklist: DEFAULT_CHECKIN_CHECKLIST.filter((entry) => states[entry.key]).map((entry) => ({
          key: entry.key,
          label: entry.label,
          state: states[entry.key]!,
          note: notes[entry.key] ?? '',
        })),
        damages,
        accessories,
        notes: generalNotes,
        confirmOdometerDecrease: confirmDecrease,
      });
      toast.success('Check-in registrado.');
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'ODOMETER_DECREASE') {
        setDecreaseWarning(err.problem?.detail ?? 'Quilometragem menor que a anterior.');
        setConfirmDecrease(true);
        return;
      }
      toast.error(errorMessage(err));
    }
  }

  return (
    <>
      <DialogHeader
        title={`Check-in da OS ${order.number}`}
        description={`${order.vehicle.make} ${order.vehicle.model}${order.vehicle.plate ? ` · ${order.vehicle.plate}` : ''}`}
      />
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Quilometragem de entrada" htmlFor="ci-km" error={decreaseWarning ?? undefined}>
            <AdornedInput
              trailing="km"
              {...fieldA11y('ci-km', decreaseWarning ?? undefined)}
              inputMode="numeric"
              value={odometer}
              onChange={(event) => {
                setOdometer(event.target.value);
                setDecreaseWarning(null);
                setConfirmDecrease(false);
              }}
              placeholder="82.000"
            />
          </Field>
          <Field label="Combustível" htmlFor="ci-fuel">
            <Select id="ci-fuel" value={fuelLevel} onChange={(event) => setFuelLevel(event.target.value)}>
              {Object.entries(FUEL_LEVEL_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {decreaseWarning && (
          <Alert variant="warning">
            {decreaseWarning} Confirme para registrar assim mesmo (a correção fica no histórico).
          </Alert>
        )}

        <section>
          <h3 className="mb-2 text-sm font-semibold">Checklist</h3>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {DEFAULT_CHECKIN_CHECKLIST.map((entry) => (
              <li key={entry.key} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <span className="min-w-40 flex-1 text-sm">{entry.label}</span>
                <div role="radiogroup" aria-label={entry.label} className="flex gap-1">
                  {CHECKLIST_STATES.map((state) => (
                    <button
                      key={state}
                      type="button"
                      role="radio"
                      aria-checked={states[entry.key] === state}
                      onClick={() => setStates((current) => ({ ...current, [entry.key]: state }))}
                      className={cn(
                        'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                        states[entry.key] === state ? STATE_STYLES[state] : 'text-muted hover:bg-surface-muted',
                      )}
                    >
                      {CHECKLIST_STATE_LABELS[state]}
                    </button>
                  ))}
                </div>
                {states[entry.key] === 'ISSUE' && (
                  <Input
                    aria-label={`Observação sobre ${entry.label}`}
                    className="w-full sm:w-56"
                    value={notes[entry.key] ?? ''}
                    onChange={(event) => setNotes((current) => ({ ...current, [entry.key]: event.target.value }))}
                    placeholder="O que foi visto"
                  />
                )}
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h3 className="mb-2 text-sm font-semibold">Avarias</h3>
          {damages.length > 0 && (
            <ul className="mb-2 divide-y divide-border rounded-lg border border-border">
              {damages.map((damage, index) => (
                <li key={index} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="truncate">
                    {DAMAGE_ZONE_LABELS[damage.zone]} · {DAMAGE_KIND_LABELS[damage.kind]}
                    {damage.note && <span className="text-muted"> — {damage.note}</span>}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    aria-label="Remover avaria"
                    onClick={() => setDamages((current) => current.filter((_, i) => i !== index))}
                  >
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <DamageForm onAdd={(damage) => setDamages((current) => [...current, damage])} />
        </section>

        <section>
          <h3 className="mb-2 text-sm font-semibold">Acessórios conferidos</h3>
          <div className="flex flex-wrap gap-2">
            {DEFAULT_ACCESSORIES.map((accessory) => {
              const checked = accessories.includes(accessory);
              return (
                <button
                  key={accessory}
                  type="button"
                  aria-pressed={checked}
                  onClick={() =>
                    setAccessories((current) =>
                      checked ? current.filter((item) => item !== accessory) : [...current, accessory],
                    )
                  }
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-sm transition-colors',
                    checked
                      ? 'border-accent bg-accent-soft text-accent dark:border-accent-bright dark:text-accent-bright'
                      : 'border-border text-muted hover:bg-surface-muted',
                  )}
                >
                  {accessory}
                </button>
              );
            })}
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-sm font-semibold">Fotos</h3>
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium shadow-xs hover:bg-surface-muted">
              <Camera className="size-4" aria-hidden="true" />
              {upload.isPending ? 'Enviando…' : 'Adicionar fotos'}
              <input
                type="file"
                accept="image/*"
                multiple
                capture="environment"
                className="sr-only"
                onChange={(event) => {
                  void addPhotos(event.target.files);
                  event.target.value = '';
                }}
              />
            </label>
            <span className="text-xs text-muted">A foto é reduzida no aparelho antes de subir.</span>
          </div>
          {attachments.data && attachments.data.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {attachments.data.map((attachment) => (
                <li key={attachment.id} className="w-24">
                  {attachment.url ? (
                    <img src={attachment.url} alt={attachment.caption ?? 'Foto do veículo'} className="h-24 w-24 rounded-lg border border-border object-cover" />
                  ) : (
                    <div className="grid h-24 w-24 place-items-center rounded-lg border border-border bg-surface-muted text-xs text-muted">
                      enviando
                    </div>
                  )}
                  <span className="mt-1 block text-center text-[11px] text-muted">{formatBytes(attachment.sizeBytes)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <Field label="Observações do check-in" htmlFor="ci-notes">
          <Textarea
            id="ci-notes"
            rows={2}
            value={generalNotes}
            onChange={(event) => setGeneralNotes(event.target.value)}
            placeholder="Ex.: cliente pediu para guardar as peças trocadas"
          />
        </Field>
      </div>
      <DialogFooter>
        <Button variant="secondary" onClick={onDone}>
          Cancelar
        </Button>
        <Button loading={create.isPending} onClick={() => void submit()}>
          {confirmDecrease ? 'Confirmar e registrar' : 'Registrar check-in'}
        </Button>
      </DialogFooter>
    </>
  );
}

function DamageForm({ onAdd }: { onAdd(damage: Damage): void }) {
  const [zone, setZone] = useState<DamageZone>('FRONT_LEFT');
  const [kind, setKind] = useState<DamageKind>('SCRATCH');
  const [note, setNote] = useState('');
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label="Local" htmlFor="damage-zone" className="w-44">
        <Select id="damage-zone" value={zone} onChange={(event) => setZone(event.target.value as DamageZone)}>
          {DAMAGE_ZONES.map((value) => (
            <option key={value} value={value}>
              {DAMAGE_ZONE_LABELS[value]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Tipo" htmlFor="damage-kind" className="w-36">
        <Select id="damage-kind" value={kind} onChange={(event) => setKind(event.target.value as DamageKind)}>
          {DAMAGE_KINDS.map((value) => (
            <option key={value} value={value}>
              {DAMAGE_KIND_LABELS[value]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Observação" htmlFor="damage-note" className="min-w-44 flex-1">
        <Input id="damage-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Opcional" />
      </Field>
      <Button
        variant="secondary"
        onClick={() => {
          onAdd({ zone, kind, note: note.trim() });
          setNote('');
        }}
      >
        Adicionar avaria
      </Button>
    </div>
  );
}
