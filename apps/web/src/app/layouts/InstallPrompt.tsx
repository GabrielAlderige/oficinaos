import { Download, Share, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/button';
import { useIsPhone } from '../../lib/use-media-query';
import { usePersistentState } from '../../lib/use-persistent-state';

/** O evento que o Chrome dispara quando o site pode virar aplicativo. */
interface EventoDeInstalacao extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const jaInstalado = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  // no iPhone, o Safari marca assim quando o site foi para a tela inicial
  (window.navigator as { standalone?: boolean }).standalone === true;

const ehIphone = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

/**
 * O convite para instalar o OficinaOS no celular (E24).
 *
 * Aparece uma vez, embaixo, e some quando a pessoa fecha — convite que
 * reaparece a cada tela é propaganda, não ajuda. No Android o próprio Chrome
 * instala com um toque; no iPhone não existe esse botão, então o que dá para
 * fazer é ensinar o caminho (Compartilhar → Adicionar à Tela de Início).
 */
export function InstallPrompt() {
  const celular = useIsPhone();
  const [dispensado, setDispensado] = usePersistentState('oficinaos:instalar-dispensado', false);
  const [evento, setEvento] = useState<EventoDeInstalacao | null>(null);
  const [mostrarIphone, setMostrarIphone] = useState(false);

  useEffect(() => {
    const aoPoderInstalar = (evt: Event) => {
      // sem isto o Chrome mostra a barra dele, e ficam dois convites na tela
      evt.preventDefault();
      setEvento(evt as EventoDeInstalacao);
    };
    window.addEventListener('beforeinstallprompt', aoPoderInstalar);
    // o iPhone não dispara evento nenhum: a decisão é pelo que dá para saber
    if (ehIphone() && !jaInstalado()) setMostrarIphone(true);
    return () => window.removeEventListener('beforeinstallprompt', aoPoderInstalar);
  }, []);

  if (!celular || dispensado || jaInstalado()) return null;
  if (!evento && !mostrarIphone) return null;

  return (
    <div className="border-t border-border bg-surface px-4 py-3 lg:hidden">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent dark:text-accent-bright">
          <Download className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Instalar o OficinaOS no celular</p>
          {evento ? (
            <p className="text-xs text-muted">Abre em tela cheia, com ícone na tela inicial.</p>
          ) : (
            <p className="flex flex-wrap items-center gap-1 text-xs text-muted">
              No iPhone: toque em <Share className="inline size-3" aria-hidden="true" /> Compartilhar → “Adicionar à
              Tela de Início”.
            </p>
          )}
          {evento && (
            <Button
              size="sm"
              className="mt-2"
              onClick={async () => {
                await evento.prompt();
                await evento.userChoice;
                setEvento(null);
                setDispensado(true);
              }}
            >
              Instalar
            </Button>
          )}
        </div>
        <button
          type="button"
          onClick={() => setDispensado(true)}
          aria-label="Dispensar o convite para instalar"
          className="-mt-1 -mr-1 rounded-md p-2 text-muted hover:bg-surface-muted hover:text-foreground"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
