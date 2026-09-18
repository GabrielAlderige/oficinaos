import { formatBRL, formatBRLInput, parseBRL, type FinancialDirection } from '@oficinaos/shared';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Alert } from '../../components/ui/display';
import { Field, fieldA11y, Select } from '../../components/ui/field';
import { AdornedInput, Input, Textarea } from '../../components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '../../components/ui/overlays';
import { errorMessage } from '../../lib/errors';
import { useCreateEntry, useFinancialCategories } from './api';
import { PartyPicker } from './PartyPicker';
import { hojeIso } from './status';

/**
 * Lançamento manual: o aluguel, a luz, o salário, o dinheiro que entrou sem OS.
 * O que nasce da OS e da compra a API cria sozinha — por isso aqui não há campo
 * de documento.
 */
export function EntryFormDialog({ direction, open, onOpenChange }: {
  direction: FinancialDirection;
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <Corpo direction={direction} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function Corpo({ direction, onDone }: { direction: FinancialDirection; onDone(): void }) {
  const receber = direction === 'RECEIVABLE';
  const criar = useCreateEntry();
  const categorias = useFinancialCategories();
  const daDirecao = (categorias.data ?? []).filter((c) => c.direction === direction);

  const [descricao, setDescricao] = useState('');
  const [categoria, setCategoria] = useState('');
  const [valor, setValor] = useState('');
  const [vencimento, setVencimento] = useState(hojeIso());
  const [parcelas, setParcelas] = useState('1');
  const [quem, setQuem] = useState<{ id: string; name: string } | null>(null);
  const [notas, setNotas] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  const categoriaEscolhida = categoria || daDirecao[0]?.id || '';
  const centavos = parseBRL(valor || '0') ?? 0;
  const quantidade = Math.max(1, Math.min(48, Number(parcelas) || 1));

  async function salvar() {
    setErro(null);
    if (descricao.trim().length < 2) return setErro('Descreva o lançamento.');
    if (!categoriaEscolhida) return setErro('Escolha uma categoria.');
    if (centavos <= 0) return setErro('Informe um valor válido.');
    try {
      await criar.mutateAsync({
        direction,
        categoryId: categoriaEscolhida,
        description: descricao.trim(),
        amountCents: centavos,
        dueDate: vencimento,
        customerId: receber ? (quem?.id ?? null) : null,
        supplierId: receber ? null : (quem?.id ?? null),
        notes: notas,
        installments: quantidade,
      });
      toast.success(quantidade > 1 ? `${quantidade} parcelas lançadas.` : 'Lançamento criado.');
      onDone();
    } catch (err) {
      setErro(errorMessage(err));
    }
  }

  return (
    <>
      <DialogHeader
        title={receber ? 'Nova conta a receber' : 'Nova conta a pagar'}
        description={
          receber
            ? 'Para o que não veio de uma OS: um acerto antigo, uma venda de peça no balcão.'
            : 'Aluguel, luz, salário, imposto. A nota de compra já entra sozinha ao ser recebida.'
        }
      />
      <div className="space-y-4">
        {erro && <Alert variant="danger">{erro}</Alert>}

        <Field label="Descrição" htmlFor="finance-description">
          <Input
            {...fieldA11y('finance-description')}
            autoFocus
            value={descricao}
            onChange={(event) => setDescricao(event.target.value)}
            placeholder={receber ? 'Ex.: acerto do Seu João' : 'Ex.: aluguel de setembro'}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Categoria" htmlFor="finance-category">
            <Select
              id="finance-category"
              value={categoriaEscolhida}
              onChange={(event) => setCategoria(event.target.value)}
              disabled={categorias.isPending}
            >
              {daDirecao.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Valor" htmlFor="finance-amount">
            <AdornedInput
              {...fieldA11y('finance-amount')}
              leading="R$"
              inputMode="numeric"
              value={valor}
              onChange={(event) => setValor(formatBRLInput(parseBRL(event.target.value) ?? 0))}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={receber ? 'Primeiro vencimento' : 'Vencimento'} htmlFor="finance-due">
            <Input
              {...fieldA11y('finance-due')}
              type="date"
              value={vencimento}
              onChange={(event) => setVencimento(event.target.value)}
            />
          </Field>
          <Field
            label="Parcelas"
            htmlFor="finance-installments"
            hint={
              quantidade > 1 && centavos > 0
                ? `${quantidade}× de ${formatBRL(Math.floor(centavos / quantidade))}, uma por mês`
                : 'Mensais, a partir do vencimento.'
            }
          >
            <Input
              {...fieldA11y('finance-installments', undefined, true)}
              inputMode="numeric"
              value={parcelas}
              onChange={(event) => setParcelas(event.target.value.replace(/\D/g, '').slice(0, 2))}
            />
          </Field>
        </div>

        <PartyPicker
          kind={receber ? 'customer' : 'supplier'}
          label={receber ? 'Cliente' : 'Fornecedor'}
          value={quem}
          onChange={setQuem}
        />

        <Field label="Observação" htmlFor="finance-notes">
          <Textarea
            id="finance-notes"
            rows={2}
            value={notas}
            onChange={(event) => setNotas(event.target.value)}
            placeholder="Opcional"
          />
        </Field>
      </div>
      <DialogFooter>
        <Button variant="secondary" onClick={onDone}>
          Cancelar
        </Button>
        <Button loading={criar.isPending} onClick={() => void salvar()}>
          Lançar
        </Button>
      </DialogFooter>
    </>
  );
}
