import {
  availableActions,
  nextAction,
  stepIndex,
  WORK_ORDER_NEXT_HINT,
  WORK_ORDER_STEP_LABELS,
  WORK_ORDER_STEPS,
  formatBRL,
  PAYMENT_STATUS_LABELS,
  saldoCents,
  WORK_ORDER_STATUS_LABELS,
  WORK_ORDER_STATUS_TONES,
  type PaymentStatus,
  type WorkOrder,
  type WorkOrderAction,
  type WorkOrderStatus,
} from '@oficinaos/shared';
import { Link2, MessageCircle, Star } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Alert, Badge } from '../../components/ui/display';
import { Field, fieldA11y } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { ConfirmDialog, Dialog, DialogContent, DialogFooter, DialogHeader } from '../../components/ui/overlays';
import { cn } from '../../lib/cn';
import { errorMessage } from '../../lib/errors';
import { useMe } from '../../lib/session';
import { useInviteReview } from '../aftersales/api';
import { useOrganizationSettings } from '../settings/api';
import { assinaturaComoArquivo, SignaturePad } from './SignaturePad';
import { useEntregar, useRunAction, useTrackingLink, useVehicleReady } from './api';

export function StatusBadge({ status }: { status: WorkOrderStatus }) {
  return <Badge tone={WORK_ORDER_STATUS_TONES[status]}>{WORK_ORDER_STATUS_LABELS[status]}</Badge>;
}

/** Só aparece quando há saldo em aberto: "a pagar" em tudo seria ruído. */
export function PaymentBadge({ status }: { status: PaymentStatus }) {
  if (status === 'PAID') return <Badge tone="success">{PAYMENT_STATUS_LABELS.PAID}</Badge>;
  if (status === 'PARTIAL') return <Badge tone="warning">{PAYMENT_STATUS_LABELS.PARTIAL}</Badge>;
  return null;
}

/**
 * Botões de status da OS. Quem decide o que aparece é a máquina de estados do
 * shared, cruzada com as permissões do papel — a mesma tabela que a API usa
 * para barrar.
 */
export function StatusActions({ order }: { order: WorkOrder }) {
  const me = useMe();
  const run = useRunAction(order.id);
  const vehicleReady = useVehicleReady(order.id);
  const pedirAvaliacao = useInviteReview(order.id);
  const linkDeAcompanhamento = useTrackingLink(order.id);
  const [cancelling, setCancelling] = useState(false);
  const [delivering, setDelivering] = useState(false);
  /** ações que mexem em dinheiro ou estoque e pedem "tem certeza?" (E34) */
  const [confirmando, setConfirmando] = useState<'skip-quote' | 'complete' | null>(null);
  const actions = availableActions(order.status, (permission) => me.permissions.includes(permission));

  if (!actions.length && order.status !== 'COMPLETED' && order.status !== 'DELIVERED') return null;

  async function fire(action: WorkOrderAction, reason?: string) {
    try {
      const updated = await run.mutateAsync({ action, reason });
      toast.success(`OS ${updated.number}: ${WORK_ORDER_STATUS_LABELS[updated.status].toLowerCase()}.`);
      setCancelling(false);
      setDelivering(false);
      setConfirmando(null);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  /** O convite leva ao GOOGLE da oficina; sem WhatsApp, fica na área de transferência. */
  async function convidarParaAvaliar() {
    try {
      const { message, whatsappUrl, publicUrl } = await pedirAvaliacao.mutateAsync();
      if (whatsappUrl) {
        window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
        toast.success('Convite pronto para enviar, com o link do Google.');
        return;
      }
      await navigator.clipboard.writeText(`${message}
${publicUrl}`);
      toast.success('O cliente não tem WhatsApp cadastrado. O convite foi copiado.');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  /** O link de acompanhamento vai pelo WhatsApp; sem WhatsApp, é copiado. */
  async function mandarAcompanhamento() {
    try {
      const { message, whatsappUrl, publicUrl } = await linkDeAcompanhamento.mutateAsync();
      if (whatsappUrl) {
        window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
        return;
      }
      await navigator.clipboard.writeText(`${message}
${publicUrl}`);
      toast.success('O cliente não tem WhatsApp cadastrado. O link foi copiado.');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function avisarPronto() {
    try {
      const { message, whatsappUrl, via } = await vehicleReady.mutateAsync();
      // com o WhatsApp oficial conectado (E22), quem envia é o servidor: não há
      // aba para abrir, e a tela precisa dizer que a mensagem foi
      if (via === 'API') {
        toast.success('Avisamos o cliente pelo WhatsApp.');
        return;
      }
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

  // quem decide o próximo passo é o caminho feliz do shared, NÃO a ordem da
  // máquina de estados — nela "aguardando peça" vem antes de "finalizar
  // serviço". Ele vira o botão cheio; o resto fica secundário, porque com tudo
  // do mesmo peso nenhum botão parecia "o certo" (D65)
  const proxima = nextAction(actions);

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {actions.map(({ action, label, requiresReason }) => (
          <Button
            key={action}
            size="sm"
            variant={action === 'cancel' ? 'ghost' : action === proxima?.action ? 'primary' : 'secondary'}
            disabled={run.isPending}
            onClick={() => {
              if (requiresReason) return setCancelling(true);
              if (action === 'deliver') return setDelivering(true);
              if (action === 'skip-quote' || action === 'complete') return setConfirmando(action);
              void fire(action);
            }}
          >
            {label}
          </Button>
        ))}
        {/* o cliente pergunta "e o meu carro?" o dia inteiro: o link responde (E17) */}
        {order.status !== 'CANCELED' && (
          <Button
            size="sm"
            variant="ghost"
            loading={linkDeAcompanhamento.isPending}
            onClick={() => void mandarAcompanhamento()}
          >
            <Link2 />
            Link de acompanhamento
          </Button>
        )}
        {order.status === 'COMPLETED' && (
          <Button size="sm" variant="secondary" loading={vehicleReady.isPending} onClick={() => void avisarPronto()}>
            <MessageCircle />
            Avisar que está pronto
          </Button>
        )}
        {/* a avaliação é do serviço pronto: só depois de entregar o carro (E16) */}
        {order.status === 'DELIVERED' && (
          <Button size="sm" variant="secondary" loading={pedirAvaliacao.isPending} onClick={() => void convidarParaAvaliar()}>
            <Star />
            Pedir avaliação
          </Button>
        )}
      </div>
      {/* pular o orçamento libera execução sem aprovação escrita, e finalizar
          tira peça do estoque e cria conta a receber: nenhuma das duas pode
          acontecer por um clique distraído (D68) */}
      <ConfirmDialog
        open={confirmando === 'skip-quote'}
        onOpenChange={(estado) => !estado && setConfirmando(null)}
        title="Executar sem orçamento?"
        description={
          <>
            O cliente não aprovou nada por escrito. Se ele contestar o valor depois, você não tem a aprovação para
            mostrar.
            <span className="mt-2 block">
              Os itens de hoje entram como aprovados, a peça sai do estoque na finalização, e fica registrado na
              timeline que foi você quem liberou.
            </span>
          </>
        }
        confirmLabel="Executar assim mesmo"
        onConfirm={() => fire('skip-quote')}
      />
      <ConfirmDialog
        open={confirmando === 'complete'}
        onOpenChange={(estado) => !estado && setConfirmando(null)}
        title="Finalizar o serviço?"
        description={
          <>
            As peças aprovadas <strong>saem do estoque</strong> agora, e a OS vira conta a receber no financeiro.
            <span className="mt-2 block">O carro ainda não é entregue: isso é o próximo passo.</span>
          </>
        }
        confirmLabel="Finalizar serviço"
        onConfirm={() => fire('complete')}
      />

      <CancelDialog open={cancelling} onOpenChange={setCancelling} number={order.number} onConfirm={(reason) => fire('cancel', reason)} />
      <DeliverDialog
        open={delivering}
        onOpenChange={setDelivering}
        order={order}
        onEntregue={(numero) => toast.success(`OS ${numero}: veículo entregue.`)}
      />
    </>
  );
}

/**
 * Onde a OS está e o que falta (E33).
 *
 * Antes a tela tinha uma fileira de botões do mesmo tamanho e nenhuma frase:
 * quem abria não sabia se "Finalizar serviço" encerrava tudo ou se ainda
 * faltava entregar. A trilha responde "onde estou", a frase responde "e
 * agora" — e os dois finais deixam de se confundir.
 */
export function WorkOrderProgress({ order }: { order: WorkOrder }) {
  const atual = stepIndex(order.status);
  const cancelada = order.status === 'CANCELED';

  return (
    <div className="mb-4 rounded-lg border border-border bg-surface px-4 py-3">
      {!cancelada && (
        <ol className="flex flex-wrap items-center gap-x-2 gap-y-1" aria-label="Etapas da OS">
          {WORK_ORDER_STEPS.map((etapa, indice) => {
            const passou = indice < atual;
            const aqui = indice === atual;
            return (
              <li key={etapa} className="flex items-center gap-2">
                <span
                  aria-current={aqui ? 'step' : undefined}
                  className={cn(
                    'flex items-center gap-1.5 text-xs font-medium',
                    aqui ? 'text-foreground' : 'text-muted',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn('size-2 rounded-full', aqui ? 'bg-accent' : passou ? 'bg-success' : 'bg-border')}
                  />
                  {WORK_ORDER_STEP_LABELS[etapa]}
                  {passou && <span className="sr-only">(concluída)</span>}
                  {aqui && <span className="sr-only">(etapa atual)</span>}
                </span>
                {indice < WORK_ORDER_STEPS.length - 1 && (
                  <span aria-hidden="true" className="h-px w-4 bg-border sm:w-6" />
                )}
              </li>
            );
          })}
        </ol>
      )}
      <p className={cn('text-sm text-muted', !cancelada && 'mt-2')}>{WORK_ORDER_NEXT_HINT[order.status]}</p>
    </div>
  );
}

/**
 * Entrega do veículo (E28): a hora de colher a prova.
 *
 * Assinatura, fotos e km são **opcionais** — a oficina que quer comprovante
 * liga "exigir assinatura" nas configurações e aí o botão só libera depois de
 * assinar. Quem entrega com aperto de mão continua entregando em dois cliques.
 */
function DeliverDialog({ open, onOpenChange, order, onEntregue }: {
  open: boolean;
  onOpenChange(open: boolean): void;
  order: WorkOrder;
  onEntregue(numero: number): void;
}) {
  const settings = useOrganizationSettings();
  const entrega = useEntregar(order.id);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [assinou, setAssinou] = useState(false);
  const [quemRecebeu, setQuemRecebeu] = useState('');
  const [fotos, setFotos] = useState<File[]>([]);
  const [km, setKm] = useState('');
  const [busy, setBusy] = useState(false);

  const falta = saldoCents(order.totals);
  const exigeAssinatura = settings.data?.requireDeliverySignature ?? false;

  async function entregar() {
    setBusy(true);
    try {
      const atualizada = await entrega.entregar({
        signerName: quemRecebeu.trim(),
        assinatura: assinou ? await assinaturaComoArquivo(canvasRef.current) : null,
        fotos,
        odometerKm: km.trim() ? Number(km.replace(/\D/g, '')) || null : null,
        notes: '',
      });
      onEntregue(atualizada.number);
      onOpenChange(false);
      setAssinou(false);
      setQuemRecebeu('');
      setFotos([]);
      setKm('');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader
          title={`Entregar o veículo da OS ${order.number}`}
          description="Assinatura e fotos são opcionais — servem de comprovante se o cliente voltar."
        />

        <div className="space-y-4">
          {falta > 0 && (
            <Alert variant="warning">
              Falta receber <strong>{formatBRL(falta)}</strong>. A entrega fica registrada assim mesmo.
            </Alert>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Quem recebeu" htmlFor="entrega-quem" hint="Opcional. Nem sempre é o dono do carro.">
              <Input
                {...fieldA11y('entrega-quem', undefined, true)}
                value={quemRecebeu}
                onChange={(evento) => setQuemRecebeu(evento.target.value)}
                placeholder="Ex.: Maria Pereira"
              />
            </Field>
            <Field label="Km na saída" htmlFor="entrega-km" hint="Opcional. Vira o km atual do carro.">
              <Input
                {...fieldA11y('entrega-km', undefined, true)}
                inputMode="numeric"
                value={km}
                onChange={(evento) => setKm(evento.target.value)}
                placeholder="Ex.: 51200"
              />
            </Field>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium">
              Assinatura de quem recebe
              {exigeAssinatura && <span className="ml-1 font-normal text-muted">(obrigatória nesta oficina)</span>}
            </p>
            <SignaturePad canvasRef={canvasRef} onChange={setAssinou} />
          </div>

          <div>
            <p className="mb-2 text-sm font-medium">Fotos do carro saindo</p>
            <input
              type="file"
              accept="image/*"
              multiple
              aria-label="Fotos do carro na entrega"
              className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-surface-muted file:px-3 file:py-1.5 file:text-sm"
              onChange={(evento) => setFotos([...fotos, ...Array.from(evento.target.files ?? [])].slice(0, 12))}
            />
            {fotos.length > 0 && (
              <ul className="mt-2 space-y-1">
                {fotos.map((foto, indice) => (
                  <li key={`${foto.name}-${indice}`} className="flex items-center justify-between gap-2 text-sm">
                    <span className="min-w-0 truncate text-muted">{foto.name}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Tirar ${foto.name} da entrega`}
                      onClick={() => setFotos(fotos.filter((_, i) => i !== indice))}
                    >
                      Remover
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Voltar
          </Button>
          <Button loading={busy} disabled={exigeAssinatura && !assinou} onClick={() => void entregar()}>
            Entregar veículo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Cancelar exige motivo: fica na timeline e na auditoria. */
function CancelDialog({ open, onOpenChange, number, onConfirm }: {
  open: boolean;
  onOpenChange(open: boolean): void;
  number: number;
  onConfirm(reason: string): Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const tooShort = reason.trim().length < 3;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setReason('');
      }}
    >
      <DialogContent>
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (tooShort) return;
            setBusy(true);
            void onConfirm(reason.trim()).finally(() => setBusy(false));
          }}
        >
          <DialogHeader
            title={`Cancelar a OS ${number}?`}
            description="A OS para de aceitar alterações. O histórico continua guardado."
          />
          <Field label="Motivo do cancelamento" htmlFor="cancel-reason" hint="Aparece na timeline e na auditoria.">
            <Input
              {...fieldA11y('cancel-reason', undefined, true)}
              autoFocus
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Ex.: cliente desistiu do serviço"
            />
          </Field>
          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Voltar
            </Button>
            <Button type="submit" variant="danger" loading={busy} disabled={tooShort}>
              Cancelar OS
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
