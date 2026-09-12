import { formatBRL, formatQuantity, WORK_ORDER_STATUS_LABELS } from '@oficinaos/shared';
import { useEffect } from 'react';
import { Link, useParams } from 'react-router';
import { Alert } from '../../components/ui/display';
import { errorMessage } from '../../lib/errors';
import { formatDate, formatDateTime } from '../../lib/format';
import { displayDocument, displayPhone } from '../../lib/contact';
import { useOrganization } from '../settings/api';
import { useWorkOrder } from './api';

/**
 * OS impressa: é o papel que vai junto do carro e o comprovante que o cliente
 * assina no balcão. Fora do AppShell de propósito — menu lateral não vai para o
 * papel — e sem nada que dependa de interação.
 */
export function PrintPage() {
  const { number = '' } = useParams();
  const order = useWorkOrder(Number(number));
  const organization = useOrganization();
  const ready = order.isSuccess && organization.isSuccess;

  useEffect(() => {
    if (!ready) return;
    // deixa a fonte e o layout assentarem antes de abrir a caixa de impressão
    const timer = setTimeout(() => window.print(), 400);
    return () => clearTimeout(timer);
  }, [ready]);

  if (order.isError) {
    return (
      <div className="p-8">
        <Alert variant="danger">
          {errorMessage(order.error)}{' '}
          <Link to="/ordens" className="underline">
            Voltar
          </Link>
        </Alert>
      </div>
    );
  }
  if (!order.data) return <p className="p-8 text-sm text-muted">Carregando…</p>;

  const os = order.data;
  const shop = organization.data;
  const address = shop?.address;
  const addressLine = address
    ? [[address.street, address.number].filter(Boolean).join(', '), address.district, [address.city, address.state].filter(Boolean).join(' - ')]
        .filter(Boolean)
        .join(' · ')
    : '';

  return (
    <div className="mx-auto max-w-3xl bg-white p-8 text-[13px] text-black print:p-0">
      <style>{`@page { margin: 14mm; } @media print { body { background: #fff; } }`}</style>

      <header className="flex items-start justify-between gap-6 border-b border-neutral-300 pb-4">
        <div>
          <h1 className="text-lg font-bold">{shop?.name ?? 'Oficina'}</h1>
          {shop?.document && <p>{displayDocument(shop.document)}</p>}
          {addressLine && <p>{addressLine}</p>}
          <p>{[displayPhone(shop?.whatsapp ?? null), displayPhone(shop?.phone ?? null)].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="text-right">
          <p className="text-xl font-bold">OS {os.number}</p>
          <p>{WORK_ORDER_STATUS_LABELS[os.status]}</p>
          <p>Aberta em {formatDate(os.openedAt)}</p>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-6 border-b border-neutral-300 py-4">
        <div>
          <h2 className="mb-1 font-semibold">Cliente</h2>
          <p>{os.customer.name}</p>
          <p>{displayPhone(os.customer.whatsapp)}</p>
        </div>
        <div>
          <h2 className="mb-1 font-semibold">Veículo</h2>
          <p>
            {os.vehicle.make} {os.vehicle.model} {os.vehicle.version ?? ''}
          </p>
          <p>
            {[os.vehicle.plate, os.vehicle.yearManufacture && `${os.vehicle.yearManufacture}/${os.vehicle.yearModel ?? os.vehicle.yearManufacture}`, os.odometerKm && `${os.odometerKm.toLocaleString('pt-BR')} km`]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
      </section>

      {(os.complaint || os.diagnosis) && (
        <section className="border-b border-neutral-300 py-4">
          {os.complaint && (
            <p className="mb-2">
              <span className="font-semibold">Relato: </span>
              {os.complaint}
            </p>
          )}
          {os.diagnosis && (
            <p>
              <span className="font-semibold">Diagnóstico: </span>
              {os.diagnosis}
            </p>
          )}
        </section>
      )}

      <section className="py-4">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-neutral-400 text-left">
              <th className="py-1.5">Item</th>
              <th className="w-20 py-1.5 text-right">Qtd.</th>
              <th className="w-28 py-1.5 text-right">Unitário</th>
              <th className="w-28 py-1.5 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {os.items.map((item) => (
              <tr key={item.id} className="border-b border-neutral-200">
                <td className="py-1.5">
                  {item.description}
                  {item.isOptional && <span className="text-neutral-500"> (recomendado)</span>}
                </td>
                <td className="py-1.5 text-right tabular-nums">{formatQuantity(Math.round(item.quantity * 1000))}</td>
                <td className="py-1.5 text-right tabular-nums">{formatBRL(item.unitPriceCents)}</td>
                <td className="py-1.5 text-right tabular-nums">{formatBRL(item.totalCents)}</td>
              </tr>
            ))}
            {!os.items.length && (
              <tr>
                <td colSpan={4} className="py-3 text-center text-neutral-500">
                  Sem itens lançados.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="mt-3 ml-auto w-64 space-y-1">
          <Line label="Subtotal" value={os.totals.subtotalCents} />
          {os.totals.discountCents > 0 && <Line label="Desconto" value={-os.totals.discountCents} />}
          {os.totals.surchargeCents > 0 && <Line label="Acréscimo" value={os.totals.surchargeCents} />}
          <div className="flex justify-between border-t border-neutral-400 pt-1 text-base font-bold">
            <span>Total</span>
            <span className="tabular-nums">{formatBRL(os.totals.totalCents)}</span>
          </div>
        </div>
      </section>

      {os.customerNotes && (
        <section className="border-t border-neutral-300 py-4">
          <h2 className="mb-1 font-semibold">Observações</h2>
          <p className="whitespace-pre-line">{os.customerNotes}</p>
        </section>
      )}

      <section className="border-t border-neutral-300 pt-4">
        {(os.warrantyDays || os.warrantyKm) && (
          <p className="mb-4">
            <span className="font-semibold">Garantia: </span>
            {[os.warrantyDays && `${os.warrantyDays} dias`, os.warrantyKm && `${os.warrantyKm.toLocaleString('pt-BR')} km`]
              .filter(Boolean)
              .join(' ou ')}
          </p>
        )}
        <div className="mt-10 grid grid-cols-2 gap-10">
          <div className="border-t border-neutral-500 pt-1 text-center">Assinatura do cliente</div>
          <div className="border-t border-neutral-500 pt-1 text-center">{shop?.name ?? 'Oficina'}</div>
        </div>
        <p className="mt-6 text-center text-[11px] text-neutral-500">Impresso em {formatDateTime(new Date().toISOString())}</p>
      </section>
    </div>
  );
}

function Line({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between">
      <span>{label}</span>
      <span className="tabular-nums">{formatBRL(value)}</span>
    </div>
  );
}
