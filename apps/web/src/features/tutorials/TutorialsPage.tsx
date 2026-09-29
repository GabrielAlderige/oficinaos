import type { TutorialLesson, TutorialModuleGroup, TutorialOverview } from '@oficinaos/shared';
import { duracaoLegivel } from '@oficinaos/shared';
import { Check, CirclePlay, GraduationCap, PlayCircle } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Alert, Badge, Card, PageHeader, Skeleton } from '../../components/ui/display';
import { EmptyState } from '../../components/ui/list-parts';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '../../components/ui/overlays';
import { errorMessage } from '../../lib/errors';
import { cn } from '../../lib/cn';
import { useSetWatched, useTutorials } from './api';

/**
 * Tutoriais em vídeo (E39).
 *
 * A área de aprendizado da oficina: um vídeo curto por funcionalidade,
 * agrupado na ordem do dia de trabalho. Fica no menu **sem exigir permissão**
 * — quem mais precisa de tutorial é quem está começando, e normalmente é o
 * mecânico ou o atendente, não o dono.
 *
 * Enquanto a aula não tem vídeo gravado ela não é publicada, então esta tela
 * nunca mostra um título que abre em tela preta. Se nada foi publicado ainda,
 * a tela diz isso em vez de fingir uma biblioteca vazia.
 */
export function TutorialsPage() {
  const visao = useTutorials();

  return (
    <>
      <PageHeader
        title="Tutoriais"
        description="Vídeos curtos ensinando cada parte do sistema. Assista na ordem ou vá direto no que você precisa agora."
      />
      {visao.isPending ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : visao.isError ? (
        <Alert variant="danger">{errorMessage(visao.error)}</Alert>
      ) : (
        <Conteudo dados={visao.data} />
      )}
    </>
  );
}

function Conteudo({ dados }: { dados: TutorialOverview }) {
  const [aberta, setAberta] = useState<TutorialLesson | null>(null);

  if (!dados.totalLessons) {
    return (
      <EmptyState
        icon={GraduationCap}
        title="Os vídeos estão sendo gravados"
        description="Assim que a primeira aula for publicada ela aparece aqui. Enquanto isso, cada tela do sistema tem a explicação do que faz no próprio lugar."
      />
    );
  }

  const proxima = dados.modules.flatMap((m) => m.lessons).find((a) => a.id === dados.nextLessonId) ?? null;

  return (
    <div className="space-y-6">
      <Progresso dados={dados} proxima={proxima} onAbrir={setAberta} />
      {dados.modules.map((modulo) => (
        <Modulo key={modulo.module} modulo={modulo} onAbrir={setAberta} />
      ))}
      <Player aula={aberta} onFechar={() => setAberta(null)} />
    </div>
  );
}

function Progresso({
  dados,
  proxima,
  onAbrir,
}: {
  dados: TutorialOverview;
  proxima: TutorialLesson | null;
  onAbrir(aula: TutorialLesson): void;
}) {
  const pronto = dados.watchedLessons === dados.totalLessons;
  const porcento = Math.round((dados.watchedLessons / dados.totalLessons) * 100);

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="font-medium">
            {pronto ? 'Você viu todas as aulas' : `${dados.watchedLessons} de ${dados.totalLessons} aulas assistidas`}
          </p>
          <p className="text-sm text-muted">
            {pronto
              ? 'Quando sair funcionalidade nova, a aula dela aparece aqui.'
              : proxima
                ? `Próxima: ${proxima.title}`
                : 'Escolha por onde começar.'}
          </p>
        </div>
        {proxima && (
          <Button onClick={() => onAbrir(proxima)}>
            <CirclePlay />
            Continuar
          </Button>
        )}
      </div>
      {/* a barra é decorativa: o número acima já diz o mesmo para o leitor de tela */}
      <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
        <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${porcento}%` }} />
      </div>
    </Card>
  );
}

function Modulo({ modulo, onAbrir }: { modulo: TutorialModuleGroup; onAbrir(aula: TutorialLesson): void }) {
  const completo = modulo.watchedCount === modulo.lessons.length;
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2 px-5 pt-5">
        <div className="min-w-0">
          <h2 className="font-medium">{modulo.label}</h2>
          <p className="text-sm text-muted">{modulo.hint}</p>
        </div>
        <Badge tone={completo ? 'success' : 'neutral'}>
          {modulo.watchedCount}/{modulo.lessons.length}
        </Badge>
      </div>
      <ul className="mt-4 divide-y divide-border">
        {modulo.lessons.map((aula) => (
          <li key={aula.id}>
            <Aula aula={aula} onAbrir={() => onAbrir(aula)} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Aula({ aula, onAbrir }: { aula: TutorialLesson; onAbrir(): void }) {
  const marcar = useSetWatched();
  const duracao = duracaoLegivel(aula.durationSeconds);

  return (
    <div className="flex items-center gap-3 px-5 py-3">
      <button
        type="button"
        onClick={onAbrir}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg py-1 text-left hover:text-accent"
      >
        <span
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-full',
            aula.watched ? 'bg-success/15 text-success' : 'bg-surface-muted text-muted',
          )}
          aria-hidden="true"
        >
          {aula.watched ? <Check className="size-4" /> : <PlayCircle className="size-4" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{aula.title}</span>
          {aula.description && <span className="block truncate text-xs text-muted">{aula.description}</span>}
        </span>
        {duracao && <span className="shrink-0 text-xs tabular-nums text-muted">{duracao}</span>}
      </button>
      <Button
        variant="ghost"
        size="sm"
        loading={marcar.isPending}
        onClick={() => marcar.mutate({ id: aula.id, watched: !aula.watched })}
        aria-label={aula.watched ? `Desmarcar ${aula.title}` : `Marcar ${aula.title} como assistida`}
      >
        {aula.watched ? 'Assistida' : 'Marcar'}
      </Button>
    </div>
  );
}

/**
 * O vídeo abre por cima, e não numa página nova, porque a pessoa está
 * escolhendo numa lista e volta para ela na sequência. Fechar marca a aula
 * como assistida: quem chegou ao fim do vídeo não quer procurar um botão.
 */
function Player({ aula, onFechar }: { aula: TutorialLesson | null; onFechar(): void }) {
  const marcar = useSetWatched();

  return (
    <Dialog open={aula !== null} onOpenChange={(estado) => !estado && onFechar()}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        {aula && (
          <>
            <DialogHeader title={aula.title} description={aula.description || undefined} />
            {aula.embedUrl ? (
              <div className="aspect-video w-full max-w-full overflow-hidden rounded-xl bg-black">
                <iframe
                  src={aula.embedUrl}
                  title={aula.title}
                  className="h-full w-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture; fullscreen"
                  allowFullScreen
                />
              </div>
            ) : (
              <Alert variant="warning">
                O vídeo desta aula não está disponível. Avise o suporte para a gente republicar.
              </Alert>
            )}
            <DialogFooter>
              {!aula.watched && (
                <Button
                  variant="secondary"
                  loading={marcar.isPending}
                  onClick={() => marcar.mutate({ id: aula.id, watched: true })}
                >
                  <Check />
                  Marcar como assistida
                </Button>
              )}
              <Button onClick={onFechar}>Fechar</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
