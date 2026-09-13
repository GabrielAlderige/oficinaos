import {
  DEFAULT_APPOINTMENT_MINUTES,
  dayKey,
  formatMinutes,
  fromDayKey,
  minutesOfDay,
  parseTime,
  type Appointment,
} from '@oficinaos/shared';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ApiError } from '../../lib/api-client';
import { Button } from '../../components/ui/button';
import { Alert } from '../../components/ui/display';
import { Field, fieldA11y, Select } from '../../components/ui/field';
import { Input, Textarea } from '../../components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '../../components/ui/overlays';
import { errorMessage } from '../../lib/errors';
import { useServices } from '../catalog/api';
import { CustomerSearchField, type PickedCustomer } from '../customers/CustomerSearchField';
import { useMembers } from '../settings/api';
import { useVehicles } from '../vehicles/api';
import { useConflicts, useCreateAppointment, useRescheduleAppointment } from './api';

/** O que abriu o diálogo: um clique na grade, o botão "Agendar" ou um remarcar. */
export interface RascunhoAgendamento {
  appointment?: Appointment;
  startsAt?: string | null;
  endsAt?: string;
  mechanicUserId?: string | null;
}

const DURACOES = [30, 60, 90, 120, 180, 240, 480];

interface Formulario {
  customer: PickedCustomer | null;
  vehicleId: string;
  mechanicUserId: string;
  serviceId: string;
  title: string;
  dia: string;
  hora: string;
  duracao: number;
  notes: string;
}

function inicial(rascunho: RascunhoAgendamento, timezone: string): Formulario {
  const a = rascunho.appointment;
  const inicio = a ? new Date(a.startsAt) : rascunho.startsAt ? new Date(rascunho.startsAt) : null;
  const duracao = a
    ? (Date.parse(a.endsAt) - Date.parse(a.startsAt)) / 60_000
    : DEFAULT_APPOINTMENT_MINUTES;
  return {
    customer: a ? { id: a.customerId, name: a.customerName } : null,
    vehicleId: a?.vehicleId ?? '',
    mechanicUserId: (rascunho.mechanicUserId ?? a?.mechanicUserId) ?? '',
    serviceId: a?.serviceId ?? '',
    title: a?.title ?? '',
    dia: inicio ? dayKey(inicio, timezone) : dayKey(new Date(), timezone),
    hora: formatMinutes(inicio ? minutesOfDay(inicio, timezone) : 8 * 60),
    duracao,
    notes: a?.notes ?? '',
  };
}

/**
 * Marcar e remarcar. Conflito aqui **avisa**: a API responde 422 com quem
 * colide, a tela mostra e o botão vira "Agendar mesmo assim" — que é o que a
 * oficina faz quando encaixa um cliente.
 */
export function AppointmentDialog({
  rascunho,
  onClose,
  timezone,
}: {
  rascunho: RascunhoAgendamento | null;
  onClose: () => void;
  timezone: string;
}) {
  const [form, setForm] = useState<Formulario>(() => inicial(rascunho ?? {}, timezone));
  const [conflitos, setConflitos] = useState<string[] | null>(null);
  const criar = useCreateAppointment();
  const remarcar = useRescheduleAppointment();
  const equipe = useMembers();
  const servicos = useServices({ q: '', status: 'active', page: 1, pageSize: 100 }, { enabled: Boolean(rascunho) });
  const veiculos = useVehicles({ q: '', page: 1, customerId: form.customer?.id });

  // o formulário só é remontado quando o diálogo ABRE: digitar não pode ser
  // apagado por uma releitura da agenda no meio do preenchimento
  useEffect(() => {
    if (rascunho) {
      setForm(inicial(rascunho, timezone));
      setConflitos(null);
    }
  }, [rascunho, timezone]);

  const editando = rascunho?.appointment;
  const startsAt = fromDayKey(form.dia, parseTime(form.hora), timezone);
  const endsAt = new Date(startsAt.getTime() + form.duracao * 60_000);
  const aviso = useConflicts({
    mechanicId: form.mechanicUserId || null,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    excludeId: editando?.id,
  });

  const campo = <K extends keyof Formulario>(chave: K, valor: Formulario[K]) =>
    setForm((atual) => ({ ...atual, [chave]: valor }));

  async function salvar(force: boolean) {
    if (!form.customer || !form.title.trim()) return;
    const corpo = {
      customerId: form.customer.id,
      vehicleId: form.vehicleId || null,
      mechanicUserId: form.mechanicUserId || null,
      serviceId: form.serviceId || null,
      title: form.title.trim(),
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      notes: form.notes,
      force,
    };
    try {
      if (editando) await remarcar.mutateAsync({ id: editando.id, ...corpo });
      else await criar.mutateAsync(corpo);
      toast.success(editando ? 'Agendamento atualizado.' : 'Agendamento marcado.');
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'APPOINTMENT_CONFLICT') {
        setConflitos((err.problem?.errors ?? []).map((erro) => erro.message));
        return;
      }
      toast.error(errorMessage(err));
    }
  }

  const salvando = criar.isPending || remarcar.isPending;
  const avisoVivo = !conflitos && (aviso.data?.length ?? 0) > 0;

  return (
    <Dialog open={Boolean(rascunho)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader
          title={editando ? 'Remarcar agendamento' : 'Novo agendamento'}
          description="O horário é o da oficina."
        />
        <div className="space-y-4">
          <Field label="Cliente" htmlFor="agenda-cliente">
            <CustomerSearchField
              id="agenda-cliente"
              value={form.customer}
              onChange={(cliente) => setForm((atual) => ({ ...atual, customer: cliente, vehicleId: '' }))}
            />
          </Field>

          <Field label="Veículo" htmlFor="agenda-veiculo" hint="Pode ficar em branco e ser escolhido no check-in.">
            <Select
              id="agenda-veiculo"
              value={form.vehicleId}
              disabled={!form.customer}
              onChange={(event) => campo('vehicleId', event.target.value)}
            >
              <option value="">Sem veículo definido</option>
              {(veiculos.data?.data ?? []).map((veiculo) => (
                <option key={veiculo.id} value={veiculo.id}>
                  {veiculo.make} {veiculo.model}
                  {veiculo.plate ? ` — ${veiculo.plate}` : ''}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Serviço" htmlFor="agenda-servico">
            <Select
              id="agenda-servico"
              value={form.serviceId}
              onChange={(event) => {
                const escolhido = (servicos.data?.data ?? []).find((s) => s.id === event.target.value);
                setForm((atual) => ({
                  ...atual,
                  serviceId: event.target.value,
                  title: escolhido && !atual.title ? escolhido.name : atual.title,
                }));
              }}
            >
              <option value="">Sem serviço do catálogo</option>
              {(servicos.data?.data ?? []).map((servico) => (
                <option key={servico.id} value={servico.id}>
                  {servico.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="O que vai ser feito" htmlFor="agenda-titulo">
            <Input
              id="agenda-titulo"
              value={form.title}
              maxLength={120}
              placeholder="Revisão dos 20.000 km"
              onChange={(event) => campo('title', event.target.value)}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="Dia" htmlFor="agenda-dia">
              <Input id="agenda-dia" type="date" value={form.dia} onChange={(e) => campo('dia', e.target.value)} />
            </Field>
            <Field label="Hora" htmlFor="agenda-hora">
              <Input id="agenda-hora" type="time" step={900} value={form.hora} onChange={(e) => campo('hora', e.target.value)} />
            </Field>
            <Field label="Duração" htmlFor="agenda-duracao">
              <Select
                id="agenda-duracao"
                value={String(form.duracao)}
                onChange={(event) => campo('duracao', Number(event.target.value))}
              >
                {DURACOES.map((minutos) => (
                  <option key={minutos} value={minutos}>
                    {minutos < 60 ? `${minutos} min` : `${minutos / 60} h`}
                  </option>
                ))}
                {!DURACOES.includes(form.duracao) && (
                  <option value={form.duracao}>{Math.round(form.duracao)} min</option>
                )}
              </Select>
            </Field>
          </div>

          <Field label="Mecânico" htmlFor="agenda-mecanico" hint="Sem mecânico, o horário não disputa a agenda de ninguém.">
            <Select
              id="agenda-mecanico"
              value={form.mechanicUserId}
              onChange={(event) => campo('mechanicUserId', event.target.value)}
            >
              <option value="">Definir depois</option>
              {(equipe.data ?? [])
                .filter((membro) => membro.isActive)
                .map((membro) => (
                  <option key={membro.userId} value={membro.userId}>
                    {membro.name}
                  </option>
                ))}
            </Select>
          </Field>

          <Field label="Observações" htmlFor="agenda-notas">
            <Textarea
              rows={2}
              maxLength={1000}
              value={form.notes}
              onChange={(event) => campo('notes', event.target.value)}
              {...fieldA11y('agenda-notas')}
            />
          </Field>

          {avisoVivo && (
            <Alert variant="warning">
              Este mecânico já tem compromisso nesse horário. Dá para marcar mesmo assim.
            </Alert>
          )}
          {conflitos && (
            <Alert variant="warning">
              <p className="font-medium">Horário já ocupado:</p>
              <ul className="mt-1 list-disc space-y-0.5 ps-4">
                {conflitos.map((mensagem) => (
                  <li key={mensagem}>{mensagem}</li>
                ))}
              </ul>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            loading={salvando}
            disabled={!form.customer || !form.title.trim()}
            onClick={() => void salvar(Boolean(conflitos))}
          >
            {conflitos ? 'Agendar mesmo assim' : editando ? 'Salvar' : 'Agendar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
