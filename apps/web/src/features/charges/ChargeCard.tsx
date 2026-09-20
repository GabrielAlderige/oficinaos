import {
  CHARGE_METHOD_LABELS,
  CHARGE_METHODS,
  CHARGE_STATUS_LABELS,
  CHARGE_STATUS_TONES,
  formatBRL,
  formatBRLInput,
  parseBRL,
  type Charge,
  type ChargeMethod,
  type ChargeSummary,
  type WorkOrder,
} from '@oficinaos/shared';
import { Copy, FlaskConical, QrCode, Send } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Alert, Badge, Card, CardHeader } from '../../components/ui/display';
import { Field, Select, fieldA11y } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { ConfirmDialog, Dialog, DialogContent, DialogFooter, DialogHeader } from '../../components/ui/overlays';
import { errorMessage } from '../../lib/errors';
import { formatDate, formatDateTime } from '../../lib/format';
import { useCan } from '../../lib/session';
import { useCancelCharge, useCharges, useCreateCharge, useRefundCharge } from './api';

/**
 * Cobrança online da OS (E19): manda o Pix, o boleto ou o link e espera o
 * gateway avisar. A baixa NÃO é feita aqui — ela chega pelo aviso do gateway
 * e cai no mesmo caixa do dinheiro recebido na mão (é o cartão de cima).
 */
export function ChargeCard({ order }: { order: WorkOrder }) {
  const podeVer = useCan('payments:record');
  const podeCobrar = useCan('charges:create');
  const resumo = useCharges(order.id, podeVer && order.status !== 'CANCELED');
  const [cobrando, setCobrando] = useState(false);

  if (!podeVer || order.status === 'CANCELED') return null;

  const dados = resumo.data;
  const cobrancas = dados?.charges ?? [];
  // OS sem nada a cobrar e sem histórico não precisa ocupar espaço na tela
  if (!cobrancas.length && (dados?.availableCents ?? 0) <= 0) return null;

  return (
    <Card>
      <CardHeader
        title="Cobrança online"
        description="Pix, boleto ou link. A baixa entra sozinha quando o cliente paga."
      />

      <div className="space-y-4 px-5 py-4 text-sm">
        {resumo.isError && <Alert variant="danger">{errorMessage(resumo.error)}</Alert>}

        {dados?.environment === 'SIMULATOR' && (
          <p className="flex items-start gap-2 rounded-md bg-surface-muted px-3 py-2 text-xs text-muted">
            <FlaskConical className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>
              <strong>Modo simulação.</strong> Nenhuma cobrança é criada em gateway nenhum e nenhum Pix é válido.
              Serve para percorrer o fluxo antes de contratar o gateway.
            </span>
          </p>
        )}

        {cobrancas.map((cobranca) => (
          <LinhaDaCobranca key={cobranca.id} cobranca={cobranca} resumo={dados!} workOrderId={order.id} />
        ))}

        {podeCobrar && (dados?.availableCents ?? 0) > 0 && (
          <div>
            <Button size="sm" variant="secondary" onClick={() => setCobrando(true)}>
              <QrCode />
              Cobrar {formatBRL(dados!.availableCents)}
            </Button>
          </div>
        )}
      </div>

      {dados && (
        <NovaCobrancaDialog
          workOrderId={order.id}
          open={cobrando}
          onOpenChange={setCobrando}
          disponivelCents={dados.availableCents}
        />
      )}
    </Card>
  );
}

function LinhaDaCobranca({
  cobranca,
  resumo,
  workOrderId,
}: {
  cobranca: Charge;
  resumo: ChargeSummary;
  workOrderId: string;
}) {
  const podeCobrar = useCan('charges:create');
  const podeEstornar = useCan('charges:refund');
  const cancelar = useCancelCharge(workOrderId);
  const estornar = useRefundCharge(workOrderId);
  const [motivo, setMotivo] = useState('');
  const [confirmandoEstorno, setConfirmandoEstorno] = useState(false);

  const copiar = async (texto: string, oQue: string) => {
    try {
      await navigator.clipboard.writeText(texto);
      toast.success(`${oQue} copiado.`);
    } catch {
      toast.error('Não deu para copiar. Selecione o texto e copie à mão.');
    }
  };

  return (
    <div className="space-y-2 rounded-lg border border-border px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-2">
          <strong className="tabular-nums">{formatBRL(cobranca.amountCents)}</strong>
          <span className="text-muted">{CHARGE_METHOD_LABELS[cobranca.method]}</span>
          <Badge tone={CHARGE_STATUS_TONES[cobranca.status]}>{CHARGE_STATUS_LABELS[cobranca.status]}</Badge>
        </span>
        <span className="text-xs text-muted">
          {cobranca.status === 'PAID' && cobranca.paidAt
            ? `pago em ${formatDateTime(cobranca.paidAt)}`
            : `vence em ${formatDate(`${cobranca.dueDate}T12:00:00`)}`}
        </span>
      </div>

      {cobranca.failureReason && <Alert variant="danger">{cobranca.failureReason}</Alert>}
      {cobranca.cancelReason && <p className="text-xs text-muted">Cancelada: {cobranca.cancelReason}</p>}

      {cobranca.status === 'PENDING' && (
        <div className="space-y-2">
          {cobranca.pixQrImage && (
            <img
              className="size-40 rounded-md border border-border bg-white p-1"
              src={`data:image/png;base64,${cobranca.pixQrImage}`}
              alt="QR Code do Pix desta cobrança"
            />
          )}
          {cobranca.pixPayload && (
            <div className="flex flex-wrap items-center gap-2">
              <code className="max-w-full flex-1 truncate rounded bg-surface-muted px-2 py-1 text-xs">
                {cobranca.pixPayload}
              </code>
              <Button size="sm" variant="ghost" onClick={() => void copiar(cobranca.pixPayload!, 'Código Pix')}>
                <Copy />
                Copiar
              </Button>
            </div>
          )}
          {cobranca.boletoUrl && (
            <a className="inline-block underline underline-offset-2" href={cobranca.boletoUrl} target="_blank" rel="noreferrer">
              Abrir o boleto
            </a>
          )}
          {resumo.whatsappUrl && (
            <Button size="sm" variant="secondary" asChild>
              <a href={resumo.whatsappUrl} target="_blank" rel="noreferrer">
                <Send />
                Mandar no WhatsApp
              </a>
            </Button>
          )}
          {!cobranca.paymentUrl && !cobranca.pixQrImage && (
            <p className="text-xs text-muted">
              O gateway de verdade devolve aqui o link de pagamento e o QR do Pix.
            </p>
          )}

          {podeCobrar && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <label className="sr-only" htmlFor={`motivo-${cobranca.id}`}>
                Motivo do cancelamento
              </label>
              <Input
                id={`motivo-${cobranca.id}`}
                className="w-56"
                placeholder="Motivo para cancelar"
                value={motivo}
                onChange={(event) => setMotivo(event.target.value)}
              />
              <Button
                size="sm"
                variant="ghost"
                disabled={motivo.trim().length < 5 || cancelar.isPending}
                onClick={async () => {
                  try {
                    await cancelar.mutateAsync({ id: cobranca.id, reason: motivo });
                    toast.success('Cobrança cancelada.');
                    setMotivo('');
                  } catch (erro) {
                    toast.error(errorMessage(erro));
                  }
                }}
              >
                Cancelar cobrança
              </Button>
            </div>
          )}
        </div>
      )}

      {cobranca.status === 'PAID' && podeEstornar && (
        <>
          <Button size="sm" variant="ghost" onClick={() => setConfirmandoEstorno(true)}>
            Estornar
          </Button>
          <ConfirmDialog
            open={confirmandoEstorno}
            onOpenChange={setConfirmandoEstorno}
            title="Estornar este pagamento?"
            description="O dinheiro volta para o cliente pelo gateway, o pagamento é cancelado no caixa e a OS volta a dever."
            confirmLabel="Estornar"
            destructive
            onConfirm={async () => {
              try {
                await estornar.mutateAsync(cobranca.id);
                toast.success('Cobrança estornada.');
              } catch (erro) {
                toast.error(errorMessage(erro));
              }
            }}
          />
        </>
      )}
    </div>
  );
}

function NovaCobrancaDialog({
  workOrderId,
  open,
  onOpenChange,
  disponivelCents,
}: {
  workOrderId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disponivelCents: number;
}) {
  const criar = useCreateCharge(workOrderId);
  const [method, setMethod] = useState<ChargeMethod>('PIX');
  const [valor, setValor] = useState(formatBRLInput(disponivelCents));

  async function enviar() {
    const amountCents = parseBRL(valor);
    if (amountCents === null || amountCents <= 0) {
      toast.error('Valor inválido.');
      return;
    }
    try {
      await criar.mutateAsync({ clientRequestId: crypto.randomUUID(), method, amountCents });
      toast.success('Cobrança criada.');
      onOpenChange(false);
    } catch (erro) {
      toast.error(errorMessage(erro));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader
          title="Cobrar online"
          description={`Dá para cobrar até ${formatBRL(disponivelCents)} nesta OS.`}
        />
        <div className="space-y-4">
          <Field label="Como cobrar" htmlFor="forma-cobranca">
            <Select
              {...fieldA11y('forma-cobranca')}
              value={method}
              onChange={(event) => setMethod(event.target.value as ChargeMethod)}
            >
              {CHARGE_METHODS.map((valor) => (
                <option key={valor} value={valor}>
                  {CHARGE_METHOD_LABELS[valor]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Valor" htmlFor="valor-cobranca">
            <Input {...fieldA11y('valor-cobranca')} inputMode="decimal" value={valor} onChange={(event) => setValor(event.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
          <Button disabled={criar.isPending} onClick={() => void enviar()}>
            {criar.isPending ? 'Criando…' : 'Criar cobrança'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
