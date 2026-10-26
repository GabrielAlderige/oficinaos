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
  VIDEO_MAX_SECONDS,
  type ChecklistState,
  type DamageKind,
  type DamageZone,
  type VideoUploadMimeType,
  type WorkOrder,
} from '@oficinaos/shared';
import { Camera, Lock, Trash2, Video, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
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
import { useFeature } from '../../lib/session';
import { useCreateInspection, useDeleteAttachment, useUploadFile, useUploadVideo } from './api';
import { duracao, lerDuracao, temCamera, tipoDoVideo } from './midia';

interface Damage {
  zone: DamageZone;
  kind: DamageKind;
  note: string;
}

/** Foto ou vídeo escolhido no check-in, ainda no aparelho: só sobe ao registrar. */
interface Midia {
  chave: string;
  tipo: 'foto' | 'video';
  arquivo: File;
  mimeType: VideoUploadMimeType | null;
  previa: string;
  segundos: number | null;
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
  const enviarVideo = useUploadVideo(order.id);
  const remover = useDeleteAttachment(order.id);
  const temVideo = useFeature('work_order_video');
  const [midias, setMidias] = useState<Midia[]>([]);
  const [enviando, setEnviando] = useState<string | null>(null);
  // o que já subiu numa tentativa anterior (km menor pede confirmação e um
  // segundo clique): não sobe de novo
  const enviados = useRef(new Map<string, string>());
  const celular = temCamera();

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

  // as prévias são URLs do aparelho: liberadas quando a tela fecha
  const previas = useRef<string[]>([]);
  previas.current = midias.map((midia) => midia.previa);
  useEffect(() => () => previas.current.forEach((url) => URL.revokeObjectURL(url)), []);

  async function addPhotos(files: FileList | null) {
    if (!files?.length) return;
    const novas: Midia[] = [];
    for (const file of Array.from(files)) {
      // reduzida JÁ: é ela que aparece na prévia e é ela que sobe
      const arquivo = await compressImage(file);
      novas.push({
        chave: crypto.randomUUID(),
        tipo: 'foto',
        arquivo,
        mimeType: null,
        previa: URL.createObjectURL(arquivo),
        segundos: null,
      });
    }
    setMidias((atuais) => [...atuais, ...novas]);
  }

  async function addVideo(files: FileList | null) {
    const arquivo = files?.[0];
    if (!arquivo) return;
    const mimeType = tipoDoVideo(arquivo);
    if (!mimeType) {
      toast.error('Esse arquivo não é um vídeo que o sistema reconheça (MP4, MOV ou WebM).');
      return;
    }
    const segundos = await lerDuracao(arquivo);
    if (segundos !== null && segundos > VIDEO_MAX_SECONDS + 0.5) {
      toast.error(`O vídeo tem ${duracao(Math.round(segundos))}. O limite é ${VIDEO_MAX_SECONDS} segundos: grave um mais curto.`);
      return;
    }
    // um vídeo da volta no carro: o novo troca o anterior
    setMidias((atuais) => [
      ...atuais.filter((midia) => midia.tipo !== 'video'),
      { chave: crypto.randomUUID(), tipo: 'video', arquivo, mimeType, previa: URL.createObjectURL(arquivo), segundos },
    ]);
  }

  /**
   * Sobe as fotos e o vídeo na hora de registrar, como na entrega (E28):
   * escolher e desistir não deixa arquivo solto na OS.
   */
  async function enviarMidias(): Promise<string[]> {
    const ids: string[] = [];
    const totalDeFotos = midias.filter((midia) => midia.tipo === 'foto').length;
    let numero = 0;
    for (const midia of midias) {
      const ja = enviados.current.get(midia.chave);
      if (ja) {
        ids.push(ja);
        continue;
      }
      let id: string;
      if (midia.tipo === 'foto') {
        numero += 1;
        setEnviando(`Enviando foto ${numero} de ${totalDeFotos}…`);
        id = (await upload.mutateAsync({ file: midia.arquivo })).id;
      } else {
        setEnviando('Enviando o vídeo… 0%');
        id = (
          await enviarVideo.mutateAsync({
            file: midia.arquivo,
            mimeType: midia.mimeType!,
            caption: 'Entrada do carro',
            visibleToCustomer: false,
            onProgress: (fracao) => setEnviando(`Enviando o vídeo… ${Math.round(fracao * 100)}%. Não feche esta tela.`),
          })
        ).id;
      }
      enviados.current.set(midia.chave, id);
      ids.push(id);
    }
    return ids;
  }

  function cancelar() {
    // subiu numa tentativa que não terminou: não fica solto na OS
    for (const id of enviados.current.values()) remover.mutate(id);
    onDone();
  }

  async function submit() {
    let attachmentIds: string[];
    try {
      attachmentIds = await enviarMidias();
    } catch (err) {
      toast.error(errorMessage(err));
      return;
    } finally {
      setEnviando(null);
    }
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
        attachmentIds,
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
          <h3 className="mb-2 text-sm font-semibold">Fotos e vídeo da entrada</h3>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium shadow-xs hover:bg-surface-muted">
              <Camera className="size-4" aria-hidden="true" />
              Adicionar fotos
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
            {temVideo && (
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium shadow-xs hover:bg-surface-muted">
                <Video className="size-4" aria-hidden="true" />
                {celular ? 'Gravar a volta no carro' : 'Vídeo da volta no carro'}
                <input
                  type="file"
                  accept="video/*,.mov,.mp4,.webm,.3gp,.m4v"
                  {...(celular ? { capture: 'environment' as const } : {})}
                  className="sr-only"
                  onChange={(event) => {
                    void addVideo(event.target.files);
                    event.target.value = '';
                  }}
                />
              </label>
            )}
          </div>
          <p className="mt-1.5 text-xs text-muted">
            {temVideo
              ? `Dê uma volta no carro filmando, até ${VIDEO_MAX_SECONDS} segundos: é o que encerra o "esse risco não tinha". O vídeo fica guardado até 30 dias depois da entrega e não vai para o cliente.`
              : 'A foto é reduzida no aparelho antes de subir.'}
          </p>
          {!temVideo && (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted">
              <Lock className="size-3" aria-hidden="true" />
              Vídeo da entrada do carro: a partir do plano Supercharger.
            </p>
          )}
          {midias.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {midias.map((midia) => (
                <li key={midia.chave} className="relative w-24">
                  {midia.tipo === 'foto' ? (
                    <img src={midia.previa} alt="Foto da entrada" className="h-24 w-24 rounded-lg border border-border object-cover" />
                  ) : (
                    <video
                      src={midia.previa}
                      muted
                      playsInline
                      preload="metadata"
                      aria-label="Vídeo da entrada"
                      className="h-24 w-24 rounded-lg border border-border bg-black object-cover"
                    />
                  )}
                  <button
                    type="button"
                    aria-label={midia.tipo === 'foto' ? 'Tirar esta foto' : 'Tirar este vídeo'}
                    disabled={Boolean(enviando) || create.isPending}
                    onClick={() => setMidias((atuais) => atuais.filter((outra) => outra.chave !== midia.chave))}
                    className="absolute top-1 right-1 grid size-6 place-items-center rounded-full bg-black/70 text-white hover:bg-black"
                  >
                    <X className="size-3.5" aria-hidden="true" />
                  </button>
                  <span className="mt-1 block text-center text-[11px] text-muted">
                    {midia.tipo === 'video'
                      ? `vídeo${midia.segundos !== null ? ` · ${duracao(Math.round(midia.segundos))}` : ''}`
                      : formatBytes(midia.arquivo.size)}
                  </span>
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
        {enviando && (
          <p className="text-xs text-muted sm:mr-auto sm:self-center" role="status">
            {enviando}
          </p>
        )}
        <Button variant="secondary" onClick={cancelar} disabled={Boolean(enviando)}>
          Cancelar
        </Button>
        <Button loading={Boolean(enviando) || create.isPending} onClick={() => void submit()}>
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
