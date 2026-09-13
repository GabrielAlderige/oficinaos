import {
  APPOINTMENT_STATUS_LABELS,
  APPOINTMENT_STATUS_TONES,
  availableAppointmentActions,
  formatMinutes,
  formatDayLabel,
  minutesOfDay,
  type Appointment,
} from '@oficinaos/shared';
import { CalendarClock, Car, MessageCircle, User, Wrench } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Alert, Badge } from '../../components/ui/display';
import { Field } from '../../components/ui/field';
import { Input, Textarea } from '../../components/ui/input';
import { Sheet } from '../../components/ui/overlays';
import { errorMessage } from '../../lib/errors';
import { useCan, useMe } from '../../lib/session';
import { useVehicles } from '../vehicles/api';
import { useAppointmentAction, useAppointmentConfirmation, useCheckIn } from './api';

/** Tudo menos o check-in, que tem formulário próprio e abre a OS. */
type AcaoSimples = 'confirm' | 'complete' | 'no-show' | 'cancel';

function Linha({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-sm">
      <span className="mt-0.5 text-muted" aria-hidden="true">
        {icon}
      </span>
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/**
 * A ficha do compromisso, com o que a oficina faz a partir dela: confirmar
 * presença, avisar pelo WhatsApp, remarcar e — quando o carro chega — o
 * check-in, que abre a OS e leva para ela.
 */
export function AppointmentSheet({
  appointment,
  onOpenChange,
  onReschedule,
}: {
  appointment: Appointment | null;
  onOpenChange: (open: boolean) => void;
  onReschedule: (appointment: Appointment) => void;
}) {
  return (
    <Sheet open={Boolean(appointment)} onOpenChange={onOpenChange} title={appointment?.title ?? ''}>
      {appointment && (
        <Ficha appointment={appointment} onOpenChange={onOpenChange} onReschedule={onReschedule} />
      )}
    </Sheet>
  );
}

function Ficha({
  appointment,
  onOpenChange,
  onReschedule,
}: {
  appointment: Appointment;
  onOpenChange: (open: boolean) => void;
  onReschedule: (appointment: Appointment) => void;
}) {
  const { organization, permissions } = useMe();
  const podeEditar = useCan('appointments:write');
  const navigate = useNavigate();
  const acao = useAppointmentAction();
  const checkIn = useCheckIn();
  const confirmacao = useAppointmentConfirmation();
  const [motivo, setMotivo] = useState('');
  const [cancelando, setCancelando] = useState(false);
  const [veiculoEscolhido, setVeiculoEscolhido] = useState('');
  const [km, setKm] = useState('');
  const veiculos = useVehicles({ q: '', page: 1, customerId: appointment.customerId });

  const timezone = organization.timezone;
  const inicio = new Date(appointment.startsAt);
  const fim = new Date(appointment.endsAt);
  const acoes = availableAppointmentActions(appointment.status, (permissao) => permissions.includes(permissao));

  async function executar(action: AcaoSimples) {
    try {
      if (action === 'cancel' && motivo.trim().length < 3) {
        toast.error('Explique o motivo do cancelamento.');
        return;
      }
      await acao.mutateAsync({ id: appointment.id, action, reason: motivo.trim() });
      toast.success('Agendamento atualizado.');
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  /** O carro chegou: abre a OS e vai para ela fazer a vistoria com fotos (E5). */
  async function entrar() {
    try {
      const ordem = await checkIn.mutateAsync({
        id: appointment.id,
        vehicleId: appointment.vehicleId ?? veiculoEscolhido ?? null,
        odometerKm: km.replace(/\D/g, '') ? Number(km.replace(/\D/g, '')) : null,
      });
      onOpenChange(false);
      toast.success(`OS ${ordem.number} aberta.`);
      void navigate(`/ordens/${ordem.number}`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function avisar() {
    try {
      const { whatsappUrl, message } = await confirmacao.mutateAsync(appointment.id);
      if (whatsappUrl) {
        window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
        return;
      }
      await navigator.clipboard.writeText(message);
      toast.success('O cliente não tem WhatsApp cadastrado. A mensagem foi copiada.');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={APPOINTMENT_STATUS_TONES[appointment.status]}>
          {APPOINTMENT_STATUS_LABELS[appointment.status]}
        </Badge>
        {appointment.workOrderNumber && (
          <Button variant="link" size="sm" onClick={() => void navigate(`/ordens/${appointment.workOrderNumber}`)}>
            OS {appointment.workOrderNumber}
          </Button>
        )}
      </div>

      <div className="space-y-2">
        <Linha icon={<CalendarClock className="size-4" />}>
          {formatDayLabel(inicio, timezone)}, das {formatMinutes(minutesOfDay(inicio, timezone))} às{' '}
          {formatMinutes(minutesOfDay(fim, timezone))}
        </Linha>
        <Linha icon={<User className="size-4" />}>{appointment.customerName}</Linha>
        {appointment.vehicleLabel && (
          <Linha icon={<Car className="size-4" />}>
            {appointment.vehicleLabel}
            {appointment.vehiclePlate ? ` — ${appointment.vehiclePlate}` : ''}
          </Linha>
        )}
        <Linha icon={<Wrench className="size-4" />}>{appointment.mechanicName ?? 'Sem mecânico definido'}</Linha>
        {appointment.notes && <p className="whitespace-pre-line text-sm text-muted">{appointment.notes}</p>}
        {appointment.cancelReason && (
          <Alert variant="warning">Cancelado: {appointment.cancelReason}</Alert>
        )}
      </div>

      {acoes.some((item) => item.action === 'check-in') && (
        <div className="space-y-3 rounded-lg border border-border p-3">
          <p className="text-sm font-medium">O carro chegou</p>
          {!appointment.vehicleId && (
            <Field label="Veículo" htmlFor="checkin-veiculo" hint="O agendamento foi marcado sem veículo.">
              <select
                id="checkin-veiculo"
                className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm"
                value={veiculoEscolhido}
                onChange={(event) => setVeiculoEscolhido(event.target.value)}
              >
                <option value="">Escolha o veículo</option>
                {(veiculos.data?.data ?? []).map((veiculo) => (
                  <option key={veiculo.id} value={veiculo.id}>
                    {veiculo.make} {veiculo.model}
                    {veiculo.plate ? ` — ${veiculo.plate}` : ''}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Quilometragem" htmlFor="checkin-km">
            <Input
              id="checkin-km"
              inputMode="numeric"
              placeholder="48000"
              value={km}
              onChange={(event) => setKm(event.target.value)}
            />
          </Field>
          <Button
            className="w-full"
            loading={checkIn.isPending}
            disabled={!appointment.vehicleId && !veiculoEscolhido}
            onClick={() => void entrar()}
          >
            Fazer check-in e abrir OS
          </Button>
        </div>
      )}

      {cancelando ? (
        <div className="space-y-3 rounded-lg border border-border p-3">
          <Field label="Motivo do cancelamento" htmlFor="cancelar-motivo">
            <Textarea
              id="cancelar-motivo"
              rows={2}
              maxLength={200}
              value={motivo}
              onChange={(event) => setMotivo(event.target.value)}
            />
          </Field>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setCancelando(false)}>
              Voltar
            </Button>
            <Button variant="danger" loading={acao.isPending} onClick={() => void executar('cancel')}>
              Cancelar agendamento
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {acoes
            .filter((item): item is typeof item & { action: AcaoSimples } => item.action !== 'check-in')
            .map((item) =>
              item.action === 'cancel' ? (
                <Button key={item.action} variant="secondary" onClick={() => setCancelando(true)}>
                  {item.label}
                </Button>
              ) : (
                <Button
                  key={item.action}
                  variant="secondary"
                  loading={acao.isPending}
                  onClick={() => void executar(item.action)}
                >
                  {item.label}
                </Button>
              ),
            )}
          {podeEditar && appointment.status !== 'CANCELED' && appointment.status !== 'COMPLETED' && (
            <Button variant="secondary" onClick={() => onReschedule(appointment)}>
              Remarcar
            </Button>
          )}
          <Button variant="secondary" loading={confirmacao.isPending} onClick={() => void avisar()}>
            <MessageCircle className="size-4" aria-hidden="true" />
            Confirmar pelo WhatsApp
          </Button>
        </div>
      )}
    </div>
  );
}
