import { IMPORT_COLUMNS, IMPORT_KIND_LABELS, IMPORT_KINDS, type ImportKind, type ImportResult } from '@oficinaos/shared';
import { useMutation } from '@tanstack/react-query';
import { FileUp, Upload } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Alert, Card, CardHeader } from '../../components/ui/display';
import { api } from '../../lib/api-client';
import { cn } from '../../lib/cn';
import { errorMessage } from '../../lib/errors';
import { useCan } from '../../lib/session';

/**
 * Importação de planilha (E17). A oficina que troca de sistema chega com um
 * CSV de clientes, veículos e peças — e digitar tudo de novo é o que faz ela
 * desistir na primeira semana.
 *
 * A tela **confere antes de gravar**: o primeiro botão é um ensaio que não
 * toca no banco, e só depois de ver o resultado a pessoa confirma.
 */
export function ImportPage() {
  const podeCliente = useCan('customers:write');
  const podePeca = useCan('catalog:write');
  const [kind, setKind] = useState<ImportKind>('customers');
  const [arquivo, setArquivo] = useState<{ nome: string; csv: string } | null>(null);
  const [resultado, setResultado] = useState<ImportResult | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const importar = useMutation({
    mutationFn: ({ csv, dryRun }: { csv: string; dryRun: boolean }) =>
      api<ImportResult>(`/imports/${kind}`, { method: 'POST', json: { csv, dryRun } }),
  });

  const permitido = kind === 'parts' ? podePeca : podeCliente;
  const colunas = IMPORT_COLUMNS[kind];

  async function rodar(dryRun: boolean) {
    if (!arquivo) return;
    setErro(null);
    try {
      const saida = await importar.mutateAsync({ csv: arquivo.csv, dryRun });
      setResultado(saida);
      if (!dryRun) toast.success(`${saida.created} criados e ${saida.updated} atualizados.`);
    } catch (err) {
      setErro(errorMessage(err));
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Importar planilha"
          description="Traga clientes, veículos e peças de outro sistema. O arquivo é conferido antes de gravar."
        />
        <div className="space-y-4 px-5 py-4">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="O que importar">
            {IMPORT_KINDS.map((opcao) => (
              <button
                key={opcao}
                type="button"
                aria-pressed={opcao === kind}
                onClick={() => {
                  setKind(opcao);
                  setResultado(null);
                  setErro(null);
                }}
                className={cn(
                  'rounded-full border px-3 py-1 text-sm transition-colors',
                  opcao === kind
                    ? 'border-accent-bright bg-accent-soft font-medium text-foreground'
                    : 'border-border text-muted hover:text-foreground',
                )}
              >
                {IMPORT_KIND_LABELS[opcao]}
              </button>
            ))}
          </div>

          <div className="rounded-lg border border-border bg-surface-muted/50 px-3 py-2 text-sm">
            <p>
              <strong>Colunas obrigatórias:</strong> {colunas.obrigatorias.join(', ')}
            </p>
            <p className="text-muted">
              <strong>Opcionais:</strong> {colunas.opcionais.join(', ')}
            </p>
            <p className="mt-1 text-xs text-muted">
              Aceita ponto e vírgula ou vírgula, com ou sem acento no cabeçalho.
              {kind === 'vehicles' && ' O dono é encontrado pelo documento, pelo telefone ou pelo nome exato.'}
              {kind === 'customers' && ' Cliente com o mesmo CPF/CNPJ é atualizado, não duplicado.'}
              {kind === 'parts' && ' Peça com o mesmo código interno (SKU) é atualizada, não duplicada.'}
            </p>
          </div>

          {!permitido ? (
            <Alert variant="warning">Seu papel não permite importar {IMPORT_KIND_LABELS[kind].toLowerCase()}.</Alert>
          ) : (
            <>
              {erro && <Alert variant="danger">{erro}</Alert>}
              <input
                type="file"
                accept=".csv,text/csv,text/plain"
                aria-label="Arquivo CSV"
                className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-surface-muted file:px-3 file:py-1.5 file:text-sm"
                onChange={async (event) => {
                  const escolhido = event.target.files?.[0];
                  setResultado(null);
                  setErro(null);
                  if (!escolhido) return setArquivo(null);
                  setArquivo({ nome: escolhido.name, csv: await escolhido.text() });
                }}
              />
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" disabled={!arquivo} loading={importar.isPending} onClick={() => void rodar(true)}>
                  <FileUp />
                  Conferir
                </Button>
                <Button
                  disabled={!arquivo || !resultado?.dryRun}
                  loading={importar.isPending}
                  onClick={() => void rodar(false)}
                >
                  <Upload />
                  Importar de verdade
                </Button>
              </div>
            </>
          )}
        </div>
      </Card>

      {resultado && (
        <Card>
          <CardHeader
            title={resultado.dryRun ? 'Conferência (nada foi gravado)' : 'Importação concluída'}
            description={`${resultado.total} ${resultado.total === 1 ? 'linha lida' : 'linhas lidas'}`}
          />
          <div className="space-y-4 px-5 py-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Numero rotulo={resultado.dryRun ? 'Serão criados' : 'Criados'} valor={resultado.created} />
              <Numero rotulo={resultado.dryRun ? 'Serão atualizados' : 'Atualizados'} valor={resultado.updated} />
              <Numero rotulo="Recusados" valor={resultado.skipped} alerta />
            </div>

            {resultado.preview.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs text-muted">
                      {Object.keys(resultado.preview[0]!).map((coluna) => (
                        <th key={coluna} scope="col" className="px-3 py-1.5 text-left font-medium">
                          {coluna}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {resultado.preview.map((linha, indice) => (
                      <tr key={indice}>
                        {Object.values(linha).map((valor, coluna) => (
                          <td key={coluna} className="px-3 py-1.5">
                            {valor || '–'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-1 text-xs text-muted">As primeiras linhas, do jeito que o sistema entendeu.</p>
              </div>
            )}

            {resultado.problems.length > 0 && (
              <div className="rounded-lg border border-border p-3">
                <p className="text-sm font-medium">Linhas recusadas</p>
                <ul className="mt-1 space-y-0.5 text-xs text-muted">
                  {resultado.problems.map((problema) => (
                    <li key={`${problema.line}-${problema.reason}`}>
                      linha {problema.line}: {problema.reason}
                      {problema.value ? ` (${problema.value})` : ''}
                    </li>
                  ))}
                  {resultado.skipped > resultado.problems.length && <li>…</li>}
                </ul>
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

function Numero({ rotulo, valor, alerta }: { rotulo: string; valor: number; alerta?: boolean }) {
  return (
    <div className="rounded-lg border border-border px-4 py-3">
      <p className="text-sm text-muted">{rotulo}</p>
      <p className={cn('mt-1 text-2xl font-semibold', alerta && valor > 0 && 'text-danger')}>{valor}</p>
    </div>
  );
}
