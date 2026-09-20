import {
  formatBRL,
  INVOICE_STATUS_LABELS,
  INVOICE_STATUS_TONES,
  INVOICE_STATUSES,
  type Invoice,
  type InvoiceStatus,
} from '@oficinaos/shared';
import { FlaskConical, Receipt } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Alert, Badge, Card, PageHeader, Skeleton } from '../../components/ui/display';
import { Select } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { EmptyState } from '../../components/ui/list-parts';
import { errorMessage } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';
import { InvoiceSheet } from './InvoiceSheet';
import { useInvoices } from './api';

/**
 * As notas emitidas (E18). A oficina abre aqui para achar a nota de um
 * cliente, ver o ISS do período e cancelar o que saiu errado.
 */
export function InvoicesPage() {
  const [params, setParams] = useSearchParams();
  const busca = params.get('q') ?? '';
  const status = (params.get('status') ?? '') as InvoiceStatus | '';
  const lista = useInvoices({ q: busca || undefined, status: status || undefined });
  const [aberta, setAberta] = useState<Invoice | null>(null);

  const trocar = (chave: string, valor: string) => {
    const proximos = new URLSearchParams(params);
    if (valor) proximos.set(chave, valor);
    else proximos.delete(chave);
    setParams(proximos, { replace: true });
  };

  const notas = lista.data?.data ?? [];
  const autorizadas = notas.filter((nota) => nota.status === 'AUTHORIZED');
  const issDevido = autorizadas.reduce((total, nota) => total + (nota.issRetained ? 0 : nota.issAmountCents), 0);
  const simulacao = notas.some((nota) => nota.environment === 'SIMULATOR');

  return (
    <>
      <PageHeader
        title="Notas fiscais"
        description="As notas de serviço emitidas pela oficina, com o ISS de cada uma."
      />

      {simulacao && (
        <Alert variant="warning">
          <span className="flex items-start gap-2">
            <FlaskConical className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              <strong>Modo simulação.</strong> Estas notas não foram enviadas a prefeitura nenhuma e não valem como
              documento fiscal. Configure o emissor em{' '}
              <Link className="underline underline-offset-2" to="/configuracoes/fiscal">
                Configurações → Fiscal
              </Link>
              .
            </span>
          </span>
        </Alert>
      )}

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <label className="sr-only" htmlFor="busca-nota">
            Buscar nota
          </label>
          <Input
            id="busca-nota"
            className="w-60"
            placeholder="Cliente, nota ou OS"
            defaultValue={busca}
            onChange={(event) => trocar('q', event.target.value.trim())}
          />
          <label className="sr-only" htmlFor="filtro-status-nota">
            Situação
          </label>
          <Select
            id="filtro-status-nota"
            className="w-48"
            value={status}
            onChange={(event) => trocar('status', event.target.value)}
          >
            <option value="">Todas as situações</option>
            {INVOICE_STATUSES.map((valor) => (
              <option key={valor} value={valor}>
                {INVOICE_STATUS_LABELS[valor]}
              </option>
            ))}
          </Select>
          {autorizadas.length > 0 && (
            <p className="ms-auto text-sm text-muted">
              ISS a recolher nesta página: <strong className="text-fg tabular-nums">{formatBRL(issDevido)}</strong>
            </p>
          )}
        </div>

        {lista.isPending ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : lista.isError ? (
          <Alert variant="danger">{errorMessage(lista.error)}</Alert>
        ) : notas.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title="Nenhuma nota ainda"
            description="A nota de serviço sai da OS finalizada, no botão “Emitir nota”."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-max text-sm">
              <thead className="border-b border-border text-left text-xs text-muted">
                <tr>
                  <th className="px-4 py-2 font-medium">Nota</th>
                  <th className="px-4 py-2 font-medium">Cliente</th>
                  <th className="px-4 py-2 font-medium">OS</th>
                  <th className="px-4 py-2 text-right font-medium">Valor</th>
                  <th className="px-4 py-2 text-right font-medium">ISS</th>
                  <th className="px-4 py-2 font-medium">Situação</th>
                </tr>
              </thead>
              <tbody>
                {notas.map((nota) => (
                  <tr key={nota.id} className="border-b border-border last:border-0 hover:bg-surface-muted/50">
                    <td className="px-4 py-2">
                      <button type="button" className="font-medium underline-offset-2 hover:underline" onClick={() => setAberta(nota)}>
                        {nota.invoiceNumber ?? `RPS ${nota.rpsSeries}-${nota.rpsNumber}`}
                      </button>
                      <span className="block text-xs text-muted">{formatDateTime(nota.createdAt)}</span>
                    </td>
                    <td className="px-4 py-2">{nota.customerName}</td>
                    <td className="px-4 py-2">
                      <Link className="underline-offset-2 hover:underline" to={`/ordens/${nota.workOrderNumber}`}>
                        OS nº {nota.workOrderNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatBRL(nota.totalCents)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {formatBRL(nota.issAmountCents)}
                      {nota.issRetained && <span className="block text-xs text-muted">retido</span>}
                    </td>
                    <td className="px-4 py-2">
                      <span className="flex flex-wrap items-center gap-1">
                        <Badge tone={INVOICE_STATUS_TONES[nota.status]}>{INVOICE_STATUS_LABELS[nota.status]}</Badge>
                        {/* o selo vai na LINHA também: quem bate o olho na lista não lê o aviso do topo */}
                        {nota.environment === 'SIMULATOR' && <Badge tone="warning">Simulação</Badge>}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <InvoiceSheet invoice={aberta} onOpenChange={(open) => !open && setAberta(null)} />
    </>
  );
}
