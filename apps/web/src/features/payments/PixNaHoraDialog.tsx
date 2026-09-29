import { brCode, formatBRL, mascararChavePix, type WorkOrder } from '@oficinaos/shared';
import { Copy, QrCode, Send } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Alert, Skeleton } from '../../components/ui/display';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '../../components/ui/overlays';
import { useMe } from '../../lib/session';
import { useOrganization, useOrganizationSettings } from '../settings/api';

/**
 * Pix na hora (E32): o cliente no balcão aponta a câmera e paga.
 *
 * O código sai da chave Pix da própria oficina — é um Pix de verdade, que
 * qualquer app de banco lê, e o dinheiro cai direto na conta dela. Sem gateway,
 * porém, **ninguém avisa o sistema**: a baixa continua no botão, e o aviso
 * disso fica ao lado do QR, não escondido num rodapé.
 */
export function PixNaHoraDialog({
  order,
  falta,
  aberto,
  onFechar,
  onRecebi,
}: {
  order: WorkOrder;
  falta: number;
  aberto: boolean;
  onFechar(): void;
  /** abre o registro de pagamento já com o Pix escolhido */
  onRecebi(): void;
}) {
  const settings = useOrganizationSettings();
  const oficina = useOrganization();
  const { organization } = useMe();
  // a cidade sai do endereço da oficina: pedir de novo seria dois campos
  // "Cidade" na mesma tela de configurações, e ninguém acerta qual é qual
  const cidade = oficina.data?.address?.city ?? '';
  const chave = settings.data?.pixKey?.trim() ?? '';
  const [imagem, setImagem] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const codigo =
    chave && falta > 0
      ? brCode({
          key: chave,
          // quem recebe, como aparece no app do cliente
          merchantName: organization.name,
          merchantCity: cidade,
          amountCents: falta,
          txid: `OS${order.number}`,
        })
      : '';

  useEffect(() => {
    if (!aberto || !codigo) {
      setImagem(null);
      return;
    }
    let vivo = true;
    QRCode.toDataURL(codigo, { width: 320, margin: 1, errorCorrectionLevel: 'M' })
      .then((url) => vivo && setImagem(url))
      .catch(() => vivo && setErro('Não deu para desenhar o QR Code. Use o código abaixo.'));
    return () => {
      vivo = false;
    };
  }, [aberto, codigo]);

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(codigo);
      toast.success('Código Pix copiado.');
    } catch {
      toast.error('Não deu para copiar. Selecione o código e copie à mão.');
    }
  };

  const whatsapp = order.customer.whatsapp
    ? `https://wa.me/55${order.customer.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(
        `Olá! O Pix da OS ${order.number} é ${formatBRL(falta)}. Código para copiar e colar:\n\n${codigo}`,
      )}`
    : null;

  return (
    <Dialog open={aberto} onOpenChange={(estado) => !estado && onFechar()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader
          title="Pix na hora"
          description={`OS ${order.number} · ${formatBRL(falta)}. O cliente aponta a câmera e paga direto na sua conta.`}
        />

        {!chave ? (
          <div className="space-y-3">
            <Alert variant="info">
              Falta cadastrar a <strong>chave Pix da oficina</strong>. Sem ela não dá para gerar um código que paga — e
              um QR que não paga é pior que nenhum.
            </Alert>
            <Button asChild variant="secondary">
              <Link to="/configuracoes/oficina">Cadastrar a chave Pix</Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-2">
              {erro ? (
                <Alert variant="danger">{erro}</Alert>
              ) : imagem ? (
                <img
                  src={imagem}
                  alt={`QR Code do Pix de ${formatBRL(falta)} da OS ${order.number}`}
                  className="size-56 rounded-lg border border-border bg-white p-2"
                />
              ) : (
                <Skeleton className="size-56" />
              )}
              <p className="text-center text-lg font-semibold tabular">{formatBRL(falta)}</p>
              <p className="text-center text-xs text-muted">
                Chave {mascararChavePix(chave)}
                {cidade ? ` · ${cidade}` : ''}
              </p>
            </div>

            <Alert variant="warning">
              O banco <strong>não avisa o sistema</strong>. Confira na sua conta antes de liberar o carro — e só então
              registre o recebimento aqui.
            </Alert>

            <div>
              <p className="mb-1 text-xs font-medium text-muted">Copia e cola</p>
              <code className="block max-h-24 overflow-y-auto rounded bg-surface-muted px-2 py-1.5 text-xs break-all">
                {codigo}
              </code>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => void copiar()}>
                <Copy />
                Copiar código
              </Button>
              {whatsapp && (
                <Button variant="secondary" size="sm" asChild>
                  <a href={whatsapp} target="_blank" rel="noopener noreferrer">
                    <Send />
                    Mandar no WhatsApp
                  </a>
                </Button>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="secondary" onClick={onFechar}>
            Fechar
          </Button>
          {chave && (
            <Button
              onClick={() => {
                onFechar();
                onRecebi();
              }}
            >
              <QrCode />
              Recebi, dar baixa
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
