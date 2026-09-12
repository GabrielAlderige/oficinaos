import { DEFAULT_QUOTE_VALIDITY_DAYS, formatBRL, type WorkOrder } from '@oficinaos/shared';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Alert } from '../../components/ui/display';
import { Field, fieldA11y } from '../../components/ui/field';
import { AdornedInput, Textarea } from '../../components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '../../components/ui/overlays';
import { errorMessage } from '../../lib/errors';
import { useSendQuote } from './api';

/**
 * Enviar o orçamento congela os itens em rascunho: o que o cliente vê não muda
 * mais. Por isso o diálogo mostra exatamente o que vai ser congelado.
 */
export function SendQuoteDialog({ order, open, onOpenChange }: {
  order: WorkOrder;
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <SendQuoteBody order={order} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function SendQuoteBody({ order, onDone }: { order: WorkOrder; onDone(): void }) {
  const send = useSendQuote(order.id, order.number);
  const [dias, setDias] = useState(String(DEFAULT_QUOTE_VALIDITY_DAYS));
  const [mensagem, setMensagem] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  const novos = order.items.filter((item) => item.approvalStatus === 'DRAFT');
  const total = novos.reduce((soma, item) => soma + item.totalCents, 0);
  const opcionais = novos.filter((item) => item.isOptional).length;

  async function enviar() {
    setErro(null);
    try {
      const quote = await send.mutateAsync({ validityDays: Number(dias) || DEFAULT_QUOTE_VALIDITY_DAYS, message: mensagem });
      toast.success(`Orçamento ${quote.number} pronto. Agora é só mandar o link.`);
      onDone();
    } catch (err) {
      setErro(errorMessage(err));
    }
  }

  return (
    <>
      <DialogHeader
        title="Enviar orçamento"
        description="Os itens são congelados como o cliente vai vê-los. Para mudar depois, é preciso enviar uma versão nova."
      />
      <div className="space-y-4">
        {erro && <Alert variant="danger">{erro}</Alert>}

        {novos.length === 0 ? (
          <Alert variant="warning">Não há item novo para orçar nesta OS.</Alert>
        ) : (
          <div className="rounded-lg border border-border">
            <ul className="divide-y divide-border">
              {novos.map((item) => (
                <li key={item.id} className="flex justify-between gap-3 px-3 py-2 text-sm">
                  <span className="truncate">
                    {item.description}
                    {item.isOptional && <span className="text-muted"> (recomendado)</span>}
                  </span>
                  <span className="tabular">{formatBRL(item.totalCents)}</span>
                </li>
              ))}
            </ul>
            <div className="flex justify-between border-t border-border px-3 py-2 font-medium">
              <span>Total</span>
              <span className="tabular">{formatBRL(total)}</span>
            </div>
          </div>
        )}

        {opcionais > 0 && (
          <p className="text-xs text-muted">
            {opcionais === 1 ? '1 item recomendado' : `${opcionais} itens recomendados`}: o cliente poderá desmarcar e
            aprovar só o necessário.
          </p>
        )}

        <Field label="Validade" htmlFor="quote-validity" hint="Depois disso o link para de aceitar resposta.">
          <AdornedInput
            trailing="dias"
            className="pr-14"
            {...fieldA11y('quote-validity', undefined, true)}
            inputMode="numeric"
            value={dias}
            onChange={(event) => setDias(event.target.value.replace(/\D/g, ''))}
          />
        </Field>

        <Field label="Recado para o cliente" htmlFor="quote-message" hint="Aparece no topo da página do orçamento.">
          <Textarea
            id="quote-message"
            rows={2}
            value={mensagem}
            onChange={(event) => setMensagem(event.target.value)}
            placeholder="Ex.: as pastilhas estão no fim; o disco dá para esperar a próxima revisão."
          />
        </Field>
      </div>
      <DialogFooter>
        <Button variant="secondary" onClick={onDone}>
          Cancelar
        </Button>
        <Button disabled={novos.length === 0} loading={send.isPending} onClick={() => void enviar()}>
          Gerar orçamento
        </Button>
      </DialogFooter>
    </>
  );
}
