import { type Supplier } from '@oficinaos/shared';
import { Mail, MessageCircle, Package, Pencil, Phone, Star, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { usePageCrumb } from '../../app/layouts/crumbs';
import { Button } from '../../components/ui/button';
import { Alert, Card, CardHeader, Skeleton } from '../../components/ui/display';
import { EmptyState } from '../../components/ui/list-parts';
import { ConfirmDialog } from '../../components/ui/overlays';
import { displayDocument, displayPhone, whatsappUrl } from '../../lib/contact';
import { errorMessage } from '../../lib/errors';
import { formatDate } from '../../lib/format';
import { useCan } from '../../lib/session';
import { useParts } from '../catalog/api';
import { PriceListCard } from '../parts-search/PriceListCard';
import { SupplierHistoryCard } from '../purchases/HistoryCards';
import { useDeleteSupplier, useSupplier } from './api';
import { SupplierFormDialog } from './SupplierFormDialog';

export function SupplierPage() {
  const { id = '' } = useParams();
  const fornecedor = useSupplier(id);
  usePageCrumb(fornecedor.data?.name);

  if (fornecedor.isPending) {
    return (
      <div className="space-y-4" aria-label="Carregando fornecedor">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (fornecedor.isError) {
    return (
      <Alert variant="danger">
        {errorMessage(fornecedor.error)}{' '}
        <Link to="/fornecedores" className="font-medium underline">
          Voltar para os fornecedores
        </Link>
      </Alert>
    );
  }
  return <Ficha fornecedor={fornecedor.data} />;
}

function Info({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-3 py-1.5 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words">{children || <span className="text-muted">–</span>}</dd>
    </div>
  );
}

/**
 * A ficha do fornecedor. O que ele fornece vem das peças que o têm como
 * preferido; as cotações e os pedidos feitos a ele, do histórico da E11 e da E12.
 */
function Ficha({ fornecedor }: { fornecedor: Supplier }) {
  const navigate = useNavigate();
  const podeEscrever = useCan('suppliers:write');
  const podeVerCatalogo = useCan('catalog:read');
  const pecas = useParts(
    { q: '', supplierId: fornecedor.id, attention: false, page: 1, pageSize: 10 },
    { enabled: podeVerCatalogo },
  );
  const apagar = useDeleteSupplier();
  const [editando, setEditando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);

  const whatsapp = whatsappUrl(fornecedor.whatsapp);
  const a = fornecedor.address;
  const endereco = [
    [a.street, a.number].filter(Boolean).join(', '),
    a.complement,
    a.district,
    [a.city, a.state].filter(Boolean).join(' - '),
    a.zip && a.zip.replace(/^(\d{5})(\d{3})$/, '$1-$2'),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{fornecedor.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            {fornecedor.rating !== null && (
              <span className="inline-flex items-center gap-1" aria-label={`Nota ${fornecedor.rating} de 5`}>
                {[1, 2, 3, 4, 5].map((nota) => (
                  <Star
                    key={nota}
                    aria-hidden="true"
                    className={nota <= fornecedor.rating! ? 'size-3.5 fill-warning text-warning' : 'size-3.5 text-border'}
                  />
                ))}
              </span>
            )}
            <span>Cadastrado em {formatDate(fornecedor.createdAt)}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {whatsapp && (
            <Button asChild variant="secondary">
              <a href={whatsapp} target="_blank" rel="noopener noreferrer">
                <MessageCircle />
                WhatsApp
              </a>
            </Button>
          )}
          {podeEscrever && (
            <Button variant="secondary" onClick={() => setEditando(true)}>
              <Pencil />
              Editar
            </Button>
          )}
          {podeEscrever && (
            <Button variant="ghost" onClick={() => setConfirmando(true)} aria-label="Tirar fornecedor da lista">
              <Trash2 />
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          {podeVerCatalogo && (
            <Card>
              <CardHeader
                title="Peças que a oficina compra dele"
                description={
                  fornecedor.preferredPartCount
                    ? `Preferido em ${fornecedor.preferredPartCount} ${fornecedor.preferredPartCount === 1 ? 'peça' : 'peças'}`
                    : 'Nenhuma peça tem este fornecedor como preferido ainda'
                }
              />
              {pecas.isPending ? (
                <div className="p-5">
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : pecas.data?.data.length ? (
                <ul className="divide-y divide-border border-t border-border">
                  {pecas.data.data.map((peca) => (
                    <li key={peca.id}>
                      <Link
                        to={`/pecas/${peca.id}`}
                        className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm hover:bg-surface-muted/60"
                      >
                        <span className="min-w-0 truncate">{peca.name}</span>
                        {peca.sku && <span className="shrink-0 font-mono text-xs text-muted">{peca.sku}</span>}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  icon={Package}
                  title="Sem peças ligadas"
                  description="Na ficha da peça, escolha este fornecedor como preferido. A cotação por link vai começar por ele."
                />
              )}
            </Card>
          )}

          <PriceListCard supplierId={fornecedor.id} supplierName={fornecedor.name} />

          <SupplierHistoryCard supplierId={fornecedor.id} />
        </div>

        <Card>
          <CardHeader title="Dados" />
          <dl className="border-t border-border px-5 py-3">
            <Info label="Vendedor">{fornecedor.contactName}</Info>
            <Info label="WhatsApp">
              {fornecedor.whatsapp && (
                <span className="inline-flex items-center gap-1.5">
                  <MessageCircle className="size-3.5 text-muted" aria-hidden="true" />
                  {displayPhone(fornecedor.whatsapp)}
                </span>
              )}
            </Info>
            <Info label="Telefone">
              {fornecedor.phone && (
                <span className="inline-flex items-center gap-1.5">
                  <Phone className="size-3.5 text-muted" aria-hidden="true" />
                  {displayPhone(fornecedor.phone)}
                </span>
              )}
            </Info>
            <Info label="E-mail">
              {fornecedor.email && (
                <a href={`mailto:${fornecedor.email}`} className="inline-flex items-center gap-1.5 hover:underline">
                  <Mail className="size-3.5 text-muted" aria-hidden="true" />
                  {fornecedor.email}
                </a>
              )}
            </Info>
            <Info label="Prazo médio">
              {fornecedor.leadTimeDays === null
                ? null
                : fornecedor.leadTimeDays === 0
                  ? 'Entrega no mesmo dia'
                  : `${fornecedor.leadTimeDays} ${fornecedor.leadTimeDays === 1 ? 'dia' : 'dias'}`}
            </Info>
            <Info label="Categorias">
              {fornecedor.categories.length > 0 && (
                <span className="flex flex-wrap gap-1">
                  {fornecedor.categories.map((categoria) => (
                    <Link
                      key={categoria}
                      to={`/fornecedores?categoria=${encodeURIComponent(categoria)}`}
                      className="rounded bg-surface-muted px-1.5 py-0.5 text-xs hover:underline"
                    >
                      {categoria}
                    </Link>
                  ))}
                </span>
              )}
            </Info>
            <Info label="Razão social">{fornecedor.legalName}</Info>
            <Info label="CNPJ">{displayDocument(fornecedor.document)}</Info>
            <Info label="Endereço">{endereco}</Info>
            <Info label="Observações">
              {fornecedor.notes && <span className="whitespace-pre-line">{fornecedor.notes}</span>}
            </Info>
          </dl>
        </Card>
      </div>

      <SupplierFormDialog open={editando} onOpenChange={setEditando} supplier={fornecedor} />
      <ConfirmDialog
        open={confirmando}
        onOpenChange={setConfirmando}
        destructive
        title={`Tirar ${fornecedor.name} da lista?`}
        description={
          fornecedor.preferredPartCount
            ? `Ele sai das listas, e as ${fornecedor.preferredPartCount} peças que o tinham como preferido ficam sem preferido. O histórico continua guardado.`
            : 'Ele sai das listas. O histórico continua guardado.'
        }
        confirmLabel="Tirar da lista"
        onConfirm={async () => {
          try {
            await apagar.mutateAsync(fornecedor.id);
            toast.success(`${fornecedor.name} saiu da lista.`);
            navigate('/fornecedores', { replace: true });
          } catch (err) {
            toast.error(errorMessage(err));
          }
        }}
      />
    </>
  );
}
