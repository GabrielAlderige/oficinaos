import type { IssuedSupplierLink } from '@oficinaos/shared';
import { Check, Copy, MessageCircle } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';

/**
 * Os links que acabaram de sair. Quem manda é a pessoa (wa.me abre o WhatsApp
 * dela com a mensagem pronta); fornecedor sem WhatsApp cadastrado recebe a
 * mensagem copiada, para colar onde a oficina fala com ele.
 */
export function SupplierLinks({ links }: { links: IssuedSupplierLink[] }) {
  const [enviados, setEnviados] = useState<ReadonlySet<string>>(new Set());
  const marcar = (inviteId: string) => setEnviados((atual) => new Set(atual).add(inviteId));

  async function copiar(link: IssuedSupplierLink) {
    try {
      await navigator.clipboard.writeText(link.message);
      marcar(link.inviteId);
      toast.success(`Mensagem para ${link.supplierName} copiada.`);
    } catch {
      toast.error('Não foi possível copiar. Selecione o link e copie manualmente.');
    }
  }

  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {links.map((link) => {
        const enviado = enviados.has(link.inviteId);
        return (
          <li key={link.inviteId} className="space-y-2 px-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate text-sm font-medium">{link.supplierName}</span>
              {enviado && (
                <span className="flex shrink-0 items-center gap-1 text-xs text-success">
                  <Check className="size-3.5" aria-hidden="true" />
                  {link.whatsappUrl ? 'Aberto no WhatsApp' : 'Copiada'}
                </span>
              )}
            </div>
            <p className="truncate font-mono text-xs text-muted">{link.link}</p>
            <div className="flex flex-wrap gap-2">
              {link.whatsappUrl ? (
                <Button asChild size="sm" variant={enviado ? 'secondary' : 'primary'}>
                  <a href={link.whatsappUrl} target="_blank" rel="noopener noreferrer" onClick={() => marcar(link.inviteId)}>
                    <MessageCircle />
                    Enviar pelo WhatsApp
                  </a>
                </Button>
              ) : (
                <span className="self-center text-xs text-muted">Sem WhatsApp cadastrado.</span>
              )}
              <Button size="sm" variant="secondary" onClick={() => void copiar(link)}>
                <Copy />
                Copiar mensagem
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
