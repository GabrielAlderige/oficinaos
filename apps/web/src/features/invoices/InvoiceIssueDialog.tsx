import { FISCAL_ENVIRONMENT_LABELS, formatBRL, type InvoicePreview } from '@oficinaos/shared';
import { AlertTriangle, FlaskConical } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Alert, Skeleton } from '../../components/ui/display';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '../../components/ui/overlays';
import { errorMessage } from '../../lib/errors';
import { useInvoicePreview, useIssueInvoice } from './api';

const ONDE_RESOLVER: Record<string, { rotulo: string; para: string }> = {
  oficina: { rotulo: 'Dados da oficina', para: '/configuracoes/fiscal' },
  cliente: { rotulo: 'Cadastro do cliente', para: '/clientes' },
  os: { rotulo: 'Esta OS', para: '' },
};

/**
 * Conferir e emitir a nota de serviço (E18).
 *
 * A tela mostra os números ANTES de emitir e, quando falta dado, diz o que
 * falta e **onde resolver** com link — rejeição de prefeitura chega em código
 * ("E145") e ninguém na oficina sabe o que fazer com isso.
 */
export function InvoiceIssueDialog({
  workOrderId,
  open,
  onOpenChange,
}: {
  workOrderId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const previa = useInvoicePreview(workOrderId, open);
  const emitir = useIssueInvoice(workOrderId);
  const [issRetido, setIssRetido] = useState(false);

  const dados = previa.data;
  const impedido = (dados?.pending.length ?? 0) > 0;

  async function confirmar(dados: InvoicePreview) {
    try {
      const nota = await emitir.mutateAsync({ clientRequestId: crypto.randomUUID(), issRetained: issRetido });
      if (nota.status === 'REJECTED') {
        toast.error(nota.rejectionReason ?? 'A nota foi rejeitada.');
        return;
      }
      toast.success(
        nota.status === 'QUEUED'
          ? 'Nota enviada: a prefeitura está processando.'
          : `Nota ${nota.invoiceNumber ?? ''} emitida.`.trim(),
      );
      onOpenChange(false);
      void dados;
    } catch (erro) {
      toast.error(errorMessage(erro));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader
          title="Emitir nota de serviço"
          description="Confira os números antes de mandar para a prefeitura."
        />

        {previa.isPending ? (
          <Skeleton className="h-52 w-full" />
        ) : previa.isError || !dados ? (
          <Alert variant="danger">{errorMessage(previa.error)}</Alert>
        ) : (
          <div className="space-y-4">
            {dados.environment === 'SIMULATOR' && (
              <Alert variant="warning">
                <span className="flex items-start gap-2">
                  <FlaskConical className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span>
                    <strong>Modo simulação.</strong> {FISCAL_ENVIRONMENT_LABELS.SIMULATOR}: nada é enviado à prefeitura
                    e nenhum documento fiscal é gerado. Serve para conferir o fluxo antes de contratar o emissor.
                  </span>
                </span>
              </Alert>
            )}

            {impedido && (
              <Alert variant="danger">
                <p className="font-medium">Falta preencher para conseguir emitir:</p>
                <ul className="mt-2 space-y-1.5">
                  {dados.pending.map((item) => {
                    const destino = ONDE_RESOLVER[item.onde];
                    return (
                      <li key={`${item.onde}.${item.campo}`} className="flex items-start gap-2 text-sm">
                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                        <span>
                          {item.mensagem}{' '}
                          {destino?.para && (
                            <Link className="underline underline-offset-2" to={destino.para}>
                              {destino.rotulo}
                            </Link>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </Alert>
            )}

            <div className="rounded-lg border border-border">
              <table className="w-full text-sm">
                <tbody>
                  {dados.items.map((item) => (
                    <tr key={item.workOrderItemId} className="border-b border-border last:border-0">
                      <td className="px-3 py-2">{item.description}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatBRL(item.totalCents)}</td>
                    </tr>
                  ))}
                  {!dados.items.length && (
                    <tr>
                      <td className="px-3 py-3 text-muted" colSpan={2}>
                        Esta OS não tem serviço aprovado.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <dl className="space-y-1.5 text-sm">
              <Linha rotulo="Serviços" valor={formatBRL(dados.serviceAmountCents)} />
              {dados.discountCents > 0 && <Linha rotulo="Desconto" valor={`− ${formatBRL(dados.discountCents)}`} />}
              <Linha rotulo="Base de cálculo" valor={formatBRL(dados.baseAmountCents)} />
              <Linha
                rotulo={`ISS (${(dados.issRateBps / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%)`}
                valor={formatBRL(dados.issAmountCents)}
              />
              <Linha rotulo="Total da nota" valor={formatBRL(dados.totalCents)} forte />
            </dl>

            {dados.partsAmountCents > 0 && (
              <p className="rounded-md bg-surface-muted px-3 py-2 text-xs text-muted">
                As peças desta OS ({formatBRL(dados.partsAmountCents)}) <strong>não entram</strong> nesta nota: peça é
                nota de mercadoria (NF-e), que é outra etapa.
              </p>
            )}

            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-accent"
                checked={issRetido}
                onChange={(event) => setIssRetido(event.target.checked)}
              />
              <span>
                O tomador retém o ISS
                <span className="block text-xs text-muted">
                  Marque quando o cliente (empresa) recolhe o imposto no lugar da oficina.
                </span>
              </span>
            </label>

            <details className="text-sm">
              <summary className="cursor-pointer text-muted">Ver a descrição que o cliente vai ler</summary>
              <p className="mt-2 whitespace-pre-line rounded-md bg-surface-muted px-3 py-2 text-xs">
                {dados.description}
              </p>
            </details>
          </div>
        )}

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
          <Button
            disabled={!dados || impedido || emitir.isPending}
            onClick={() => dados && void confirmar(dados)}
          >
            {emitir.isPending ? 'Emitindo…' : 'Emitir nota'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Linha({ rotulo, valor, forte }: { rotulo: string; valor: string; forte?: boolean }) {
  return (
    <div className={`flex justify-between ${forte ? 'border-t border-border pt-1.5 font-medium' : ''}`}>
      <dt className={forte ? '' : 'text-muted'}>{rotulo}</dt>
      <dd className="tabular-nums">{valor}</dd>
    </div>
  );
}
