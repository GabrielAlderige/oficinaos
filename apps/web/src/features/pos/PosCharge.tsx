import {
  formatBRL,
  formatBRLInput,
  parseBRL,
  POS_CHARGE_STATUS_LABELS,
  POS_MAX_INSTALLMENTS,
  POS_METHOD_LABELS,
  POS_METHODS,
  type PosMethod,
} from '@oficinaos/shared';
import { CheckCircle2, CreditCard, FlaskConical, XCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Alert, Skeleton } from '../../components/ui/display';
import { Field, fieldA11y, Select } from '../../components/ui/field';
import { AdornedInput } from '../../components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '../../components/ui/overlays';
import { Spinner } from '../../components/ui/spinner';
import { cn } from '../../lib/cn';
import { errorMessage } from '../../lib/errors';
import { useAtualizarCaixa, useCancelPosCharge, usePosCharge, usePosSettings, useSimulatePosPaid, useStartPosCharge } from './api';

export type OrigemDaCobranca = { workOrderId: string } | { counterSaleId: string };

/**
 * Cobrar na maquininha (E50): escolhe a maquininha, a forma e o valor, manda —
 * e a tela fica esperando o cliente passar o cartão. Quando a maquininha
 * confirma, o pagamento já está lançado no caixa; ninguém digita nada duas vezes.
 */
export function PosChargeFlow({
  origem,
  valorCents,
  onClose,
  onPaid,
}: {
  origem: OrigemDaCobranca;
  valorCents: number;
  onClose(): void;
  onPaid?(): void;
}) {
  const config = usePosSettings();
  const iniciar = useStartPosCharge();
  const [clientRequestId, setClientRequestId] = useState(() => crypto.randomUUID());
  const [cobrancaId, setCobrancaId] = useState<string | null>(null);
  const [serial, setSerial] = useState('');
  const [metodo, setMetodo] = useState<PosMethod>('CREDIT_CARD');
  const [parcelas, setParcelas] = useState(1);
  const [valor, setValor] = useState(formatBRLInput(valorCents));
  const [erro, setErro] = useState<string | null>(null);

  const maquininhas = config.data?.devices ?? [];
  const primeira = config.data?.devices[0]?.serial;
  useEffect(() => {
    if (!serial && primeira) setSerial(primeira);
  }, [primeira, serial]);

  if (cobrancaId) {
    return (
      <Esperando
        id={cobrancaId}
        onClose={onClose}
        onPaid={onPaid}
        onTentarDeNovo={() => {
          setCobrancaId(null);
          setClientRequestId(crypto.randomUUID());
        }}
      />
    );
  }

  async function enviar() {
    setErro(null);
    const centavos = parseBRL(valor || '0') ?? 0;
    if (centavos <= 0) return setErro('Informe o valor.');
    if (centavos > valorCents) return setErro(`O máximo é ${formatBRL(valorCents)}, o que falta receber.`);
    try {
      const cobranca = await iniciar.mutateAsync({
        clientRequestId,
        ...origem,
        amountCents: centavos,
        method: metodo,
        installments: metodo === 'CREDIT_CARD' ? parcelas : 1,
        deviceSerial: serial,
      });
      setCobrancaId(cobranca.id);
    } catch (err) {
      setErro(errorMessage(err));
    }
  }

  return (
    <>
      <DialogHeader title="Cobrar na maquininha" description="O valor vai direto para a tela da maquininha: o cliente só passa o cartão." />
      {config.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : config.isError ? (
        <Alert variant="danger">{errorMessage(config.error)}</Alert>
      ) : !maquininhas.length ? (
        <Alert variant="warning">
          Nenhuma maquininha cadastrada.{' '}
          <Link className="underline underline-offset-2" to="/configuracoes/maquininha">
            Cadastrar em Configurações → Maquininha
          </Link>
        </Alert>
      ) : (
        <div className="grid gap-4">
          {config.data.provider === 'simulador' || !config.data.partnerReady ? (
            <Alert variant="warning">
              <span className="flex items-start gap-2">
                <FlaskConical className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>
                  <strong>Modo simulação.</strong> Nada vai para a maquininha de verdade: depois de enviar, aperte
                  “Simular pagamento” para ver o fluxo inteiro.
                </span>
              </span>
            </Alert>
          ) : null}
          {maquininhas.length > 1 && (
            <Field label="Maquininha" htmlFor="pos-serial">
              <Select id="pos-serial" value={serial} onChange={(e) => setSerial(e.target.value)}>
                {maquininhas.map((m) => (
                  <option key={m.serial} value={m.serial}>
                    {m.name} ({m.serial})
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <div role="radiogroup" aria-label="Forma" className="grid grid-cols-3 gap-2">
            {POS_METHODS.map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={metodo === m}
                onClick={() => setMetodo(m)}
                className={cn(
                  'rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors',
                  metodo === m ? 'border-accent bg-accent-soft text-accent dark:text-accent-bright' : 'border-border text-muted hover:text-foreground',
                )}
              >
                {POS_METHOD_LABELS[m]}
              </button>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Valor" htmlFor="pos-valor" hint={`Falta receber ${formatBRL(valorCents)}.`}>
              <AdornedInput {...fieldA11y('pos-valor', undefined, true)} leading="R$" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} />
            </Field>
            {metodo === 'CREDIT_CARD' && (
              <Field label="Parcelas" htmlFor="pos-parcelas" hint="Sem juros para o cliente.">
                <Select id="pos-parcelas" value={parcelas} onChange={(e) => setParcelas(Number(e.target.value))}>
                  {Array.from({ length: POS_MAX_INSTALLMENTS }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n === 1 ? 'À vista' : `${n}x`}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
          {erro && <Alert variant="danger">{erro}</Alert>}
        </div>
      )}
      <DialogFooter>
        <Button variant="secondary" onClick={onClose} disabled={iniciar.isPending}>
          Fechar
        </Button>
        <Button loading={iniciar.isPending} disabled={!maquininhas.length || !serial} onClick={() => void enviar()}>
          <CreditCard />
          Enviar para a maquininha
        </Button>
      </DialogFooter>
    </>
  );
}

function Esperando({ id, onClose, onPaid, onTentarDeNovo }: { id: string; onClose(): void; onPaid?(): void; onTentarDeNovo(): void }) {
  const cobranca = usePosCharge(id);
  const cancelar = useCancelPosCharge();
  const simular = useSimulatePosPaid();
  const atualizarCaixa = useAtualizarCaixa();
  const avisou = useRef(false);
  const dados = cobranca.data;

  useEffect(() => {
    if (dados?.status === 'PAID' && !avisou.current) {
      avisou.current = true;
      atualizarCaixa();
      toast.success(`Pago na maquininha: ${formatBRL(dados.paidAmountCents ?? dados.amountCents)}.`);
      onPaid?.();
    }
  }, [dados, atualizarCaixa, onPaid]);

  async function desistir() {
    try {
      await cancelar.mutateAsync(id);
    } catch (err) {
      toast.error(errorMessage(err));
      void cobranca.refetch();
    }
  }

  return (
    <>
      <DialogHeader title="Cobrar na maquininha" description={dados ? POS_CHARGE_STATUS_LABELS[dados.status] : 'Enviando…'} />
      <div className="grid place-items-center gap-3 py-6 text-center">
        {!dados || dados.status === 'PENDING' ? (
          <>
            <Spinner className="size-8" />
            <p className="text-lg font-semibold tabular">{dados ? formatBRL(dados.amountCents) : ''}</p>
            <p className="max-w-sm text-sm text-muted">
              {dados?.environment === 'SIMULATOR'
                ? 'Simulação: nenhuma maquininha recebeu. Aperte “Simular pagamento” para continuar.'
                : 'Peça para o cliente passar o cartão (ou ler o Pix) na maquininha. Esta tela atualiza sozinha.'}
            </p>
            {dados?.failureReason && <Alert variant="warning">Último cartão recusado: {dados.failureReason}. Dá para tentar outro na maquininha.</Alert>}
          </>
        ) : dados.status === 'PAID' ? (
          <>
            <CheckCircle2 className="size-10 text-success" aria-hidden="true" />
            <p className="text-lg font-semibold tabular">{formatBRL(dados.paidAmountCents ?? dados.amountCents)}</p>
            <p className="text-sm text-muted">
              {[dados.cardBrand, dados.authorizationCode && `autorização ${dados.authorizationCode}`].filter(Boolean).join(' · ') || 'Pago'}. Já está
              lançado no caixa.
            </p>
          </>
        ) : (
          <>
            <XCircle className="size-10 text-danger" aria-hidden="true" />
            <p className="text-sm">{dados.failureReason ?? POS_CHARGE_STATUS_LABELS[dados.status]}</p>
          </>
        )}
      </div>
      <DialogFooter>
        {dados?.status === 'PENDING' ? (
          <>
            <Button variant="secondary" loading={cancelar.isPending} onClick={() => void desistir()}>
              Cancelar cobrança
            </Button>
            {dados.environment === 'SIMULATOR' && (
              <Button loading={simular.isPending} onClick={() => simular.mutate(id, { onError: (e) => toast.error(errorMessage(e)) })}>
                Simular pagamento
              </Button>
            )}
          </>
        ) : dados && (dados.status === 'FAILED' || dados.status === 'CANCELED') ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              Fechar
            </Button>
            <Button onClick={onTentarDeNovo}>Tentar de novo</Button>
          </>
        ) : (
          <Button onClick={onClose}>Fechar</Button>
        )}
      </DialogFooter>
    </>
  );
}

/** O fluxo num diálogo próprio (para a OS e a venda já feita). */
export function PosChargeDialog({
  open,
  onOpenChange,
  origem,
  valorCents,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  origem: OrigemDaCobranca;
  valorCents: number;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {open && <PosChargeFlow origem={origem} valorCents={valorCents} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}
