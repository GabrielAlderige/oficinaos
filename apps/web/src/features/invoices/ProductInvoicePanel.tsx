import {
  formatBRL,
  INVOICE_STATUS_LABELS,
  INVOICE_STATUS_TONES,
  PRODUCT_INVOICE_MODEL_LABELS,
  PRODUCT_INVOICE_MODELS,
  type ProductInvoice,
  type ProductInvoiceModel,
} from '@oficinaos/shared';
import { AlertTriangle, ExternalLink, FlaskConical, Receipt } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Alert, Badge, Card, CardHeader, Skeleton } from '../../components/ui/display';
import { Field, fieldA11y } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '../../components/ui/overlays';
import { errorMessage } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';
import { useCan } from '../../lib/session';
import {
  useCancelProductInvoice,
  useIssueProductInvoice,
  useProductInvoicePreview,
  useProductInvoices,
  type OrigemDaNota,
} from './product-api';

/** Onde a oficina resolve cada pendência (o mesmo "diga onde" da NFS-e). */
const ONDE_RESOLVER: Record<string, { rotulo: string; para: string }> = {
  cnpj: { rotulo: 'Dados da oficina', para: '/configuracoes/oficina' },
  ie: { rotulo: 'Configurações → Fiscal', para: '/configuracoes/fiscal' },
  icms: { rotulo: 'Configurações → Fiscal', para: '/configuracoes/fiscal' },
  ncm: { rotulo: 'Peças', para: '/pecas' },
  cliente: { rotulo: 'Clientes', para: '/clientes' },
  endereco: { rotulo: 'Clientes', para: '/clientes' },
};

/**
 * A nota fiscal das peças (E50) de uma venda de balcão ou de uma OS: mostra a
 * nota viva (com o DANFE) ou o botão de emitir. Serviço continua na NFS-e.
 */
export function ProductInvoicePanel({ origem }: { origem: OrigemDaNota }) {
  const podeVer = useCan('invoices:read');
  const podeEmitir = useCan('invoices:issue');
  const podeCancelar = useCan('invoices:cancel');
  const notas = useProductInvoices(origem, podeVer);
  const [emitindo, setEmitindo] = useState(false);
  const [cancelando, setCancelando] = useState<ProductInvoice | null>(null);

  if (!podeVer) return null;
  const lista = notas.data?.data ?? [];
  const viva = lista.find((n) => n.status === 'AUTHORIZED' || n.status === 'QUEUED');
  const recusada = !viva ? lista.find((n) => n.status === 'REJECTED') : undefined;
  const cancelada = !viva && lista.some((n) => n.status === 'CANCELED');

  return (
    <div className="space-y-2 text-sm">
      {notas.isError && <Alert variant="danger">{errorMessage(notas.error)}</Alert>}
      {viva ? (
        <div className="space-y-1.5 rounded-lg border border-border px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">
              {viva.model === 'NFCE' ? 'NFC-e' : 'NF-e'}
              {viva.number ? ` nº ${viva.number}` : ''}
            </span>
            <Badge tone={INVOICE_STATUS_TONES[viva.status]}>{INVOICE_STATUS_LABELS[viva.status]}</Badge>
            {viva.environment === 'SIMULATOR' && <Badge tone="warning">Simulação</Badge>}
            {viva.environment === 'HOMOLOGATION' && <Badge tone="warning">Homologação</Badge>}
            <span className="ml-auto tabular-nums">{formatBRL(viva.totalCents)}</span>
          </div>
          {viva.issuedAt && <p className="text-xs text-muted">Autorizada em {formatDateTime(viva.issuedAt)}</p>}
          {viva.status === 'QUEUED' && <p className="text-xs text-muted">A SEFAZ está processando; esta tela atualiza sozinha.</p>}
          {viva.environment === 'SIMULATOR' && (
            <p className="flex items-start gap-1.5 text-xs text-muted">
              <FlaskConical className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              Simulação: nenhum documento fiscal foi emitido.
            </p>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            {viva.danfeUrl && (
              <Button size="sm" variant="secondary" asChild>
                <a href={viva.danfeUrl} target="_blank" rel="noreferrer">
                  <ExternalLink />
                  {viva.model === 'NFCE' ? 'Cupom (DANFE)' : 'DANFE'}
                </a>
              </Button>
            )}
            {podeCancelar && viva.status === 'AUTHORIZED' && (
              <Button size="sm" variant="ghost" onClick={() => setCancelando(viva)}>
                Cancelar nota
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-muted">
            {recusada
              ? `A última nota foi recusada: ${recusada.rejectionReason ?? 'sem motivo informado'}`
              : cancelada
                ? 'A nota das peças foi cancelada. Dá para emitir outra.'
                : 'Ainda sem nota das peças.'}
          </p>
          {podeEmitir && (
            <Button size="sm" variant="secondary" onClick={() => setEmitindo(true)}>
              <Receipt />
              Emitir nota das peças
            </Button>
          )}
        </div>
      )}

      {emitindo && <EmitirDialog origem={origem} onClose={() => setEmitindo(false)} />}
      {cancelando && <CancelarDialog nota={cancelando} onClose={() => setCancelando(null)} />}
    </div>
  );
}

/** O mesmo painel num card, para a página da OS. */
export function ProductInvoiceCard({ workOrderId }: { workOrderId: string }) {
  const podeVer = useCan('invoices:read');
  if (!podeVer) return null;
  return (
    <Card>
      <CardHeader title="Nota das peças" description="NFC-e ou NF-e das peças que a oficina vendeu nesta OS." />
      <div className="px-5 py-4">
        <ProductInvoicePanel origem={{ workOrderId }} />
      </div>
    </Card>
  );
}

function EmitirDialog({ origem, onClose }: { origem: OrigemDaNota; onClose(): void }) {
  const [modelo, setModelo] = useState<ProductInvoiceModel>('NFCE');
  const previa = useProductInvoicePreview(origem, modelo, true);
  const emitir = useIssueProductInvoice();
  const dados = previa.data;
  const impedido = (dados?.issues.length ?? 0) > 0;

  async function confirmar() {
    try {
      const nota = await emitir.mutateAsync({
        clientRequestId: crypto.randomUUID(),
        model: modelo,
        counterSaleId: 'counterSaleId' in origem ? origem.counterSaleId : null,
        workOrderId: 'workOrderId' in origem ? origem.workOrderId : null,
      });
      if (nota.status === 'REJECTED') {
        toast.error(nota.rejectionReason ?? 'A SEFAZ recusou a nota.');
        return;
      }
      toast.success(
        nota.status === 'QUEUED' ? 'Nota enviada: a SEFAZ está processando.' : `Nota ${nota.number ?? ''} autorizada.`.replace('  ', ' '),
      );
      onClose();
    } catch (erro) {
      toast.error(errorMessage(erro));
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader title="Emitir nota das peças" description="Confira antes de mandar para a SEFAZ." />
        <div className="space-y-4">
          <div role="radiogroup" aria-label="Tipo de nota" className="grid gap-2 sm:grid-cols-2">
            {PRODUCT_INVOICE_MODELS.map((m) => (
              <label
                key={m}
                className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm ${modelo === m ? 'border-accent bg-accent/5' : 'border-border'}`}
              >
                <input
                  type="radio"
                  name="modelo-nota"
                  className="mt-0.5 accent-accent"
                  checked={modelo === m}
                  onChange={() => setModelo(m)}
                />
                <span>
                  {PRODUCT_INVOICE_MODEL_LABELS[m]}
                  <span className="block text-xs text-muted">
                    {m === 'NFCE' ? 'Para pessoa física, na hora.' : 'Empresa que quer a nota no CNPJ, com endereço.'}
                  </span>
                </span>
              </label>
            ))}
          </div>

          {previa.isPending ? (
            <Skeleton className="h-40 w-full" />
          ) : previa.isError || !dados ? (
            <Alert variant="danger">{errorMessage(previa.error)}</Alert>
          ) : (
            <>
              {dados.environment === 'SIMULATOR' && (
                <Alert variant="warning">
                  <span className="flex items-start gap-2">
                    <FlaskConical className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                    <span>
                      <strong>Modo simulação.</strong> Nada vai para a SEFAZ e nenhum documento fiscal é gerado. Serve para
                      conferir o fluxo antes de ligar o emissor.
                    </span>
                  </span>
                </Alert>
              )}
              {impedido && (
                <Alert variant="danger">
                  <p className="font-medium">Falta resolver para emitir:</p>
                  <ul className="mt-2 space-y-1.5">
                    {dados.issues.map((p, i) => {
                      const destino = ONDE_RESOLVER[p.campo];
                      return (
                        <li key={`${p.campo}-${i}`} className="flex items-start gap-2 text-sm">
                          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                          <span>
                            {p.mensagem}{' '}
                            {destino && (
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
                    {dados.items.map((item, i) => (
                      <tr key={i} className="border-b border-border last:border-0">
                        <td className="px-3 py-2">
                          {item.quantity.toLocaleString('pt-BR')} × {item.description}
                          <span className="block text-xs text-muted">
                            NCM {item.ncm || '—'} · CFOP {item.cfop}
                            {item.discountCents > 0 && ` · desconto ${formatBRL(item.discountCents)}`}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatBRL(item.totalCents)}</td>
                      </tr>
                    ))}
                    {!dados.items.length && (
                      <tr>
                        <td className="px-3 py-3 text-muted" colSpan={2}>
                          Não há peça do catálogo para pôr na nota.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-between border-t border-border pt-2 text-sm font-medium">
                <span>Total da nota</span>
                <span className="tabular-nums">{formatBRL(dados.totalCents)}</span>
              </div>
              {dados.leftOut.length > 0 && (
                <p className="rounded-md bg-surface-muted px-3 py-2 text-xs text-muted">
                  Ficam fora desta nota: {dados.leftOut.map((f) => `${f.description} (${f.reason})`).join('; ')}.
                </p>
              )}
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Fechar
          </Button>
          <Button disabled={!dados || impedido || emitir.isPending} onClick={() => void confirmar()}>
            {emitir.isPending ? 'Emitindo…' : 'Emitir nota'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CancelarDialog({ nota, onClose }: { nota: ProductInvoice; onClose(): void }) {
  const cancelar = useCancelProductInvoice();
  const [motivo, setMotivo] = useState('');
  const curto = motivo.trim().length < 15;

  async function confirmar() {
    try {
      await cancelar.mutateAsync({ id: nota.id, reason: motivo });
      toast.success('Nota cancelada.');
      onClose();
    } catch (erro) {
      toast.error(errorMessage(erro));
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader
          title="Cancelar a nota das peças"
          description={
            nota.model === 'NFCE'
              ? 'A NFC-e só se cancela até 30 minutos depois de autorizada.'
              : 'A NF-e só se cancela até 24 horas depois de autorizada.'
          }
        />
        <Field label="Motivo" htmlFor="pi-motivo" hint="A SEFAZ pede pelo menos 15 caracteres.">
          <Input {...fieldA11y('pi-motivo')} value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={255} />
        </Field>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={cancelar.isPending}>
            Voltar
          </Button>
          <Button variant="danger" disabled={curto || cancelar.isPending} onClick={() => void confirmar()}>
            {cancelar.isPending ? 'Cancelando…' : 'Cancelar nota'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
