import { Maximize, Minimize, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Button } from '../../components/ui/button';
import { useMe } from '../../lib/session';
import { PatioBoard } from './PatioBoard';

const relogio = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'America/Sao_Paulo',
});

/**
 * Modo TV (E49): o pátio na TV da parede da oficina, letra grande e sem menu.
 * Atualiza sozinho de 30 em 30 segundos; o relógio anda a cada 15.
 *
 * Fica fora do painel (como a impressão), mas exige estar logado: a TV usa a
 * conta de alguém da oficina, e a sessão se renova sozinha a cada pergunta.
 */
export function PatioTvPage() {
  const me = useMe();
  const [agora, setAgora] = useState(() => new Date());
  const [cheia, setCheia] = useState(() => Boolean(document.fullscreenElement));

  useEffect(() => {
    const id = window.setInterval(() => setAgora(new Date()), 15_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const aoMudar = () => setCheia(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', aoMudar);
    return () => document.removeEventListener('fullscreenchange', aoMudar);
  }, []);

  useEffect(() => {
    const anterior = document.title;
    document.title = `Pátio · ${me.organization.name}`;
    return () => void (document.title = anterior);
  }, [me.organization.name]);

  async function alternarTelaCheia() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      // navegador de TV sem tela cheia: segue na janela mesmo
    }
  }

  return (
    <div className="min-h-screen bg-background p-5 text-foreground">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold">Pátio · {me.organization.name}</h1>
          <p className="text-lg text-muted first-letter:uppercase">{relogio.format(agora)}</p>
        </div>
        {/* os botões somem na tela cheia: na TV ninguém clica */}
        {!cheia && (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => void alternarTelaCheia()}>
              <Maximize />
              Tela cheia
            </Button>
            <Button asChild variant="ghost">
              <Link to="/ordens?vista=patio">
                <X />
                Sair do modo TV
              </Link>
            </Button>
          </div>
        )}
        {cheia && (
          <Button variant="ghost" size="icon" aria-label="Sair da tela cheia" onClick={() => void alternarTelaCheia()}>
            <Minimize />
          </Button>
        )}
      </header>
      <PatioBoard tv agora={agora} />
    </div>
  );
}
