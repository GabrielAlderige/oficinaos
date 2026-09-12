import { formatBRL, type ApprovalDecision, type Quote, type WorkOrder } from '@oficinaos/shared';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Alert } from '../../components/ui/display';
import { Field, fieldA11y, Select } from '../../components/ui/field';
import { Input, Textarea } from '../../components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '../../components/ui/overlays';
import { cn } from '../../lib/cn';
import { errorMessage } from '../../lib/errors';
import { useManualDecision } from './api';

const OPCOES: { value: ApprovalDecision; label: string }[] = [
  { value: 'APPROVED', label: 'Aprovou tudo' },
  { value: 'PARTIALLY_APPROVED', label: 'Aprovou em parte' },
  { value: 'REJECTED', label: 'Recusou' },
];

/**
 * Metade dos clientes responde "pode fazer" no telefone ou no balcão. O sistema
 * registra isso com o mesmo peso do link — mudando só a prova: aqui fica quem
 * da equipe anotou, e não a assinatura do cliente.
 */
export function ManualDecisionDialog({ quote, order, open, onOpenChange }: {
  quote: Quote;
  order: WorkOrder;
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <ManualDecisionBody quote={quote} order={order} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function ManualDecisionBody({ quote, order, onDone }: { quote: Quote; order: WorkOrder; onDone(): void }) {
  const registrar = useManualDecision(quote.id, order.id, order.number);
  const [decision, setDecision] = useState<ApprovalDecision>('APPROVED');
  const [channel, setChannel] = useState<'PHONE' | 'IN_PERSON' | 'WHATSAPP'>('PHONE');
  const [aprovados, setAprovados] = useState<string[]>(quote.items.map((item) => item.id));
  const [nome, setNome] = useState('');
  const [notas, setNotas] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  const parcial = decision === 'PARTIALLY_APPROVED';
  const total = quote.items.filter((item) => aprovados.includes(item.id)).reduce((soma, item) => soma + item.totalCents, 0);

  async function salvar() {
    setErro(null);
    try {
      await registrar.mutateAsync({
        decision,
        channel,
        approvedItemIds: parcial ? aprovados : [],
        signerName: nome,
        notes: notas,
      });
      toast.success('Resposta do cliente registrada.');
      onDone();
    } catch (err) {
      setErro(errorMessage(err));
    }
  }

  return (
    <>
      <DialogHeader
        title="Registrar resposta do cliente"
        description={`Orçamento ${quote.number} · ${formatBRL(quote.totalCents)}. Fica registrado que foi você quem anotou.`}
      />
      <div className="space-y-4">
        {erro && <Alert variant="danger">{erro}</Alert>}

        <div role="radiogroup" aria-label="O que o cliente respondeu" className="flex flex-wrap gap-2">
          {OPCOES.map((opcao) => (
            <button
              key={opcao.value}
              type="button"
              role="radio"
              aria-checked={decision === opcao.value}
              onClick={() => setDecision(opcao.value)}
              className={cn(
                'rounded-lg border px-3 py-2 text-sm transition-colors',
                decision === opcao.value
                  ? 'border-accent bg-accent-soft font-medium text-accent dark:border-accent-bright dark:text-accent-bright'
                  : 'border-border text-muted hover:bg-surface-muted',
              )}
            >
              {opcao.label}
            </button>
          ))}
        </div>

        {parcial && (
          <div className="rounded-lg border border-border">
            <ul className="divide-y divide-border">
              {quote.items.map((item) => (
                <li key={item.id}>
                  <label className="flex items-center gap-3 px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={aprovados.includes(item.id)}
                      onChange={() =>
                        setAprovados((atual) =>
                          atual.includes(item.id) ? atual.filter((id) => id !== item.id) : [...atual, item.id],
                        )
                      }
                    />
                    <span className="min-w-0 flex-1 truncate">{item.description}</span>
                    <span className="tabular">{formatBRL(item.totalCents)}</span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="flex justify-between border-t border-border px-3 py-2 font-medium">
              <span>Aprovado</span>
              <span className="tabular">{formatBRL(total)}</span>
            </div>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Como o cliente respondeu" htmlFor="decision-channel">
            <Select
              id="decision-channel"
              value={channel}
              onChange={(event) => setChannel(event.target.value as typeof channel)}
            >
              <option value="PHONE">Por telefone</option>
              <option value="WHATSAPP">Pelo WhatsApp</option>
              <option value="IN_PERSON">Presencial</option>
            </Select>
          </Field>
          <Field label="Quem autorizou" htmlFor="decision-signer" hint="O nome de quem falou com você.">
            <Input
              {...fieldA11y('decision-signer', undefined, true)}
              value={nome}
              onChange={(event) => setNome(event.target.value)}
              placeholder="Ex.: João, dono do carro"
            />
          </Field>
        </div>

        <Field label="Observação" htmlFor="decision-notes">
          <Textarea
            id="decision-notes"
            rows={2}
            value={notas}
            onChange={(event) => setNotas(event.target.value)}
            placeholder={decision === 'REJECTED' ? 'Ex.: vai fazer mês que vem' : 'Opcional'}
          />
        </Field>
      </div>
      <DialogFooter>
        <Button variant="secondary" onClick={onDone}>
          Cancelar
        </Button>
        <Button
          disabled={parcial && aprovados.length === 0}
          loading={registrar.isPending}
          onClick={() => void salvar()}
        >
          Registrar resposta
        </Button>
      </DialogFooter>
    </>
  );
}
