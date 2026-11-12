import { DRE_ARQUIVO_MAX_MESES } from '@oficinaos/shared';
import { useMutation } from '@tanstack/react-query';
import { FileSpreadsheet, FileText } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Field, fieldA11y } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '../../components/ui/overlays';
import { cn } from '../../lib/cn';
import { errorMessage } from '../../lib/errors';
import { baixarArquivo } from '../reports/api';

type Modo = 'mensal' | 'comparativo';
type Formato = 'xlsx' | 'pdf';

const mesesEntre = (de: string, ate: string) =>
  (Number(ate.slice(0, 4)) - Number(de.slice(0, 4))) * 12 + Number(ate.slice(5, 7)) - Number(de.slice(5, 7)) + 1;

/**
 * Exportar a DRE (E51, fase 2): um mês, ou vários lado a lado para comparar.
 * O Excel sai com fórmulas (o grupo soma os itens, o lucro soma os grupos);
 * o PDF sai pronto para mandar ao contador ou imprimir.
 */
export function ExportarDreDialog({
  open,
  onOpenChange,
  mesDoPeriodo,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 'AAAA-MM' do período que está na tela: é o ponto de partida */
  mesDoPeriodo: string;
}) {
  const [modo, setModo] = useState<Modo>('mensal');
  const [mes, setMes] = useState(mesDoPeriodo);
  const [de, setDe] = useState(`${mesDoPeriodo.slice(0, 4)}-01`);
  const [ate, setAte] = useState(mesDoPeriodo);

  const [inicio, fim] = modo === 'mensal' ? [mes, mes] : [de, ate];
  const erro =
    !inicio || !fim
      ? 'Escolha o mês.'
      : inicio > fim
        ? 'O mês final vem depois do inicial.'
        : mesesEntre(inicio, fim) > DRE_ARQUIVO_MAX_MESES
          ? `No máximo ${DRE_ARQUIVO_MAX_MESES} meses por arquivo.`
          : null;

  const baixar = useMutation({
    mutationFn: (formato: Formato) =>
      baixarArquivo(`/api/v1/finance/dre/arquivo?de=${inicio}&ate=${fim}&format=${formato}`, formato),
    onSuccess: (nome) => toast.success(`${nome} baixado.`),
    onError: (e) => toast.error(errorMessage(e)),
  });

  const opcao = (valor: Modo, titulo: string, texto: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={modo === valor}
      onClick={() => setModo(valor)}
      className={cn(
        'flex-1 rounded-lg border p-3 text-left transition-colors',
        modo === valor ? 'border-accent bg-accent/5 ring-1 ring-accent' : 'border-border hover:bg-surface-muted',
      )}
    >
      <span className="block text-sm font-medium">{titulo}</span>
      <span className="mt-0.5 block text-xs text-muted">{texto}</span>
    </button>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader
          title="Exportar a DRE"
          description="Excel com as fórmulas (cada grupo soma os seus itens) ou PDF pronto para o contador, com o nome e o CNPJ da oficina."
        />
        <div role="radiogroup" aria-label="O que exportar" className="flex flex-col gap-2 sm:flex-row">
          {opcao('mensal', 'Um mês', 'A DRE do mês, com o % de cada linha')}
          {opcao('comparativo', 'Vários meses', 'Os meses lado a lado, com total e média')}
        </div>

        <div className="mt-4">
          {modo === 'mensal' ? (
            <Field label="Mês" htmlFor="dre-arquivo-mes">
              <Input {...fieldA11y('dre-arquivo-mes')} type="month" value={mes} onChange={(e) => setMes(e.target.value)} />
            </Field>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="De" htmlFor="dre-arquivo-de">
                <Input {...fieldA11y('dre-arquivo-de')} type="month" value={de} onChange={(e) => setDe(e.target.value)} />
              </Field>
              <Field label="Até" htmlFor="dre-arquivo-ate">
                <Input {...fieldA11y('dre-arquivo-ate')} type="month" value={ate} onChange={(e) => setAte(e.target.value)} />
              </Field>
            </div>
          )}
          {erro ? <p className="mt-2 text-sm text-danger">{erro}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="secondary" disabled={!!erro || baixar.isPending} onClick={() => baixar.mutate('pdf')}>
            <FileText />
            Baixar PDF
          </Button>
          <Button disabled={!!erro || baixar.isPending} onClick={() => baixar.mutate('xlsx')}>
            <FileSpreadsheet />
            Baixar Excel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
