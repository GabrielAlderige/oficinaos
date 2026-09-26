import { Monitor } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button } from '../../components/ui/button';
import { useIsPhone } from '../../lib/use-media-query';

/**
 * "Essa tela é melhor no computador" (E24).
 *
 * Algumas telas são tabelas largas e formulários compridos — nota fiscal,
 * financeiro, importação. Elas **funcionam** no celular, mas fazer conta de
 * dinheiro numa coluna de 390 px é como preencher guia de imposto no ônibus.
 *
 * Então o aviso não bloqueia: ele diz o que a pessoa vai enfrentar e oferece
 * o caminho curto (voltar) e o caminho teimoso (abrir mesmo assim). Bloquear
 * seria decidir pela oficina numa hora em que só ela sabe se dá ou não.
 */
export function DesktopHint({ titulo, children }: { titulo: string; children: ReactNode }) {
  const celular = useIsPhone();
  const [continuar, setContinuar] = useState(false);
  // a tela some do caminho de quem já está no computador
  if (!celular || continuar) return <>{children}</>;

  return (
    <div>
      <div className="mx-auto max-w-sm px-2 py-8 text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-full bg-surface-muted text-muted">
          <Monitor className="size-6" aria-hidden="true" />
        </span>
        <h1 className="mt-4 text-lg font-semibold tracking-tight">{titulo} fica melhor no computador</h1>
        <p className="mt-2 text-sm text-muted">
          Esta tela tem tabela larga e muitos campos. No celular ela cabe, mas dá trabalho: o jeito confortável é
          abrir o OficinaOS no computador do balcão.
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <Button variant="secondary" onClick={() => history.back()}>
            Voltar
          </Button>
          <Button variant="ghost" onClick={() => setContinuar(true)}>
            Abrir mesmo assim
          </Button>
        </div>
      </div>
    </div>
  );
}
