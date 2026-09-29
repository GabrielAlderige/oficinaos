import type { TutorialLesson, TutorialModule, TutorialPlayer } from '@oficinaos/shared';
import {
  duracaoLegivel,
  TUTORIAL_MODULE_LABELS,
  TUTORIAL_MODULES,
  TUTORIAL_PLAYER_LABELS,
  TUTORIAL_PLAYERS,
} from '@oficinaos/shared';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Alert, Badge, Card, CardHeader, PageHeader, Skeleton } from '../../components/ui/display';
import { Field, fieldA11y, Select } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '../../components/ui/overlays';
import { errorMessage } from '../../lib/errors';
import { useCreateLesson, useDeleteLesson, useTutorialsAdmin, useUpdateLesson } from '../tutorials/api';

/**
 * Onde as aulas do tutorial são cadastradas (E39) — área da PLATAFORMA.
 *
 * Nem o dono da oficina edita: a aula é a mesma para todas. O fluxo é gravar
 * o vídeo, subir onde quiser (YouTube não listado, Vimeo, link direto), colar
 * o endereço aqui e publicar. Enquanto não houver endereço, a aula fica
 * rascunho — e o banco recusa publicar sem vídeo.
 */
export function TutorialAdminPage() {
  const visao = useTutorialsAdmin();
  const [editando, setEditando] = useState<TutorialLesson | null>(null);
  const [criando, setCriando] = useState(false);

  const aulas = visao.data?.modules.flatMap((m) => m.lessons) ?? [];
  const publicadas = aulas.filter((a) => a.isPublished).length;

  return (
    <>
      <PageHeader
        title="Tutoriais da plataforma"
        description="As aulas que toda oficina vê. Grave o vídeo, cole o endereço e publique."
        actions={
          <Button onClick={() => setCriando(true)}>
            <Plus />
            Nova aula
          </Button>
        }
      />

      {visao.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : visao.isError ? (
        <Alert variant="danger">{errorMessage(visao.error)}</Alert>
      ) : (
        <div className="space-y-5">
          <Alert variant="info">
            <span>
              <strong>
                {publicadas} de {aulas.length} aulas publicadas.
              </strong>{' '}
              Aula sem endereço de vídeo fica em rascunho e não aparece para a oficina — título sem vídeo faria o
              cliente abrir uma tela preta.
            </span>
          </Alert>

          {TUTORIAL_MODULES.map((module) => {
            const doModulo = aulas.filter((a) => a.module === module);
            if (!doModulo.length) return null;
            return (
              <Card key={module}>
                <CardHeader title={TUTORIAL_MODULE_LABELS[module]} />
                <ul className="divide-y divide-border">
                  {doModulo.map((aula) => (
                    <li key={aula.id}>
                      <LinhaDaAula aula={aula} onEditar={() => setEditando(aula)} />
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}

          {!aulas.length && (
            <Card className="p-6 text-sm text-muted">
              Nenhuma aula cadastrada ainda. Comece pelo módulo “Primeiros passos”.
            </Card>
          )}
        </div>
      )}

      <FormularioDialog aberto={criando} aula={null} onFechar={() => setCriando(false)} />
      <FormularioDialog aberto={editando !== null} aula={editando} onFechar={() => setEditando(null)} />
    </>
  );
}

function LinhaDaAula({ aula, onEditar }: { aula: TutorialLesson; onEditar(): void }) {
  const apagar = useDeleteLesson();
  const duracao = duracaoLegivel(aula.durationSeconds);

  return (
    <div className="flex items-center gap-3 px-5 py-3">
      <button type="button" onClick={onEditar} className="min-w-0 flex-1 text-left hover:text-accent">
        <span className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium">{aula.title}</span>
          <Badge tone={aula.isPublished ? 'success' : 'neutral'}>{aula.isPublished ? 'Publicada' : 'Rascunho'}</Badge>
          {!aula.videoUrl && <Badge tone="warning">Sem vídeo</Badge>}
        </span>
        <span className="block truncate text-xs text-muted">
          {aula.slug}
          {duracao ? ` · ${duracao}` : ''}
        </span>
      </button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Apagar ${aula.title}`}
        loading={apagar.isPending}
        onClick={async () => {
          try {
            await apagar.mutateAsync(aula.id);
            toast.success('Aula apagada.');
          } catch (erro) {
            toast.error(errorMessage(erro));
          }
        }}
      >
        <Trash2 />
      </Button>
    </div>
  );
}

function FormularioDialog({
  aberto,
  aula,
  onFechar,
}: {
  aberto: boolean;
  aula: TutorialLesson | null;
  onFechar(): void;
}) {
  const criar = useCreateLesson();
  const atualizar = useUpdateLesson();
  const salvando = criar.isPending || atualizar.isPending;

  // a chave remonta os campos quando troca a aula editada
  return (
    <Dialog open={aberto} onOpenChange={(estado) => !estado && onFechar()}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <Formulario
          key={aula?.id ?? 'nova'}
          aula={aula}
          salvando={salvando}
          onSalvar={async (dados) => {
            try {
              if (aula) await atualizar.mutateAsync({ id: aula.id, ...dados });
              else await criar.mutateAsync(dados);
              toast.success(aula ? 'Aula salva.' : 'Aula criada.');
              onFechar();
            } catch (erro) {
              toast.error(errorMessage(erro));
            }
          }}
          onCancelar={onFechar}
        />
      </DialogContent>
    </Dialog>
  );
}

interface DadosDaAula {
  module: TutorialModule;
  slug: string;
  title: string;
  description: string;
  player: TutorialPlayer;
  videoUrl: string | null;
  durationSeconds: number | null;
  position: number;
  isPublished: boolean;
}

function Formulario({
  aula,
  salvando,
  onSalvar,
  onCancelar,
}: {
  aula: TutorialLesson | null;
  salvando: boolean;
  onSalvar(dados: DadosDaAula): void;
  onCancelar(): void;
}) {
  const [module, setModule] = useState<TutorialModule>(aula?.module ?? 'PRIMEIROS_PASSOS');
  const [slug, setSlug] = useState(aula?.slug ?? '');
  const [title, setTitle] = useState(aula?.title ?? '');
  const [description, setDescription] = useState(aula?.description ?? '');
  const [player, setPlayer] = useState<TutorialPlayer>(aula?.player ?? 'YOUTUBE');
  const [videoUrl, setVideoUrl] = useState(aula?.videoUrl ?? '');
  const [duracao, setDuracao] = useState(aula?.durationSeconds ? String(aula.durationSeconds) : '');
  const [position, setPosition] = useState(String(aula?.position ?? 0));
  const [isPublished, setIsPublished] = useState(aula?.isPublished ?? false);

  return (
    <>
      <DialogHeader
        title={aula ? 'Editar aula' : 'Nova aula'}
        description="O apelido entra no endereço e não deve mudar depois de publicado."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Módulo" htmlFor="aula-modulo">
          <Select
            {...fieldA11y('aula-modulo')}
            value={module}
            onChange={(evento) => setModule(evento.target.value as TutorialModule)}
          >
            {TUTORIAL_MODULES.map((m) => (
              <option key={m} value={m}>
                {TUTORIAL_MODULE_LABELS[m]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Ordem no módulo" htmlFor="aula-ordem" hint="Menor aparece primeiro.">
          <Input
            {...fieldA11y('aula-ordem', undefined, true)}
            inputMode="numeric"
            value={position}
            onChange={(evento) => setPosition(evento.target.value)}
          />
        </Field>
        <Field label="Título" htmlFor="aula-titulo" className="sm:col-span-2">
          <Input
            {...fieldA11y('aula-titulo')}
            value={title}
            onChange={(evento) => setTitle(evento.target.value)}
            placeholder="Ex.: Abrir a primeira ordem de serviço"
          />
        </Field>
        <Field label="Apelido (slug)" htmlFor="aula-slug" hint="Letras minúsculas, números e hífen.">
          <Input
            {...fieldA11y('aula-slug', undefined, true)}
            value={slug}
            onChange={(evento) => setSlug(evento.target.value)}
            placeholder="abrir-primeira-os"
          />
        </Field>
        <Field label="Duração em segundos" htmlFor="aula-duracao" hint="Opcional.">
          <Input
            {...fieldA11y('aula-duracao', undefined, true)}
            inputMode="numeric"
            value={duracao}
            onChange={(evento) => setDuracao(evento.target.value)}
            placeholder="180"
          />
        </Field>
        <Field label="O que a pessoa sai sabendo" htmlFor="aula-descricao" className="sm:col-span-2" hint="Uma frase.">
          <Input
            {...fieldA11y('aula-descricao', undefined, true)}
            value={description}
            onChange={(evento) => setDescription(evento.target.value)}
          />
        </Field>
        <Field label="Onde está o vídeo" htmlFor="aula-player">
          <Select
            {...fieldA11y('aula-player')}
            value={player}
            onChange={(evento) => setPlayer(evento.target.value as TutorialPlayer)}
          >
            {TUTORIAL_PLAYERS.map((p) => (
              <option key={p} value={p}>
                {TUTORIAL_PLAYER_LABELS[p]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Endereço do vídeo" htmlFor="aula-video" hint="Cole o link como ele está na barra do navegador.">
          <Input
            {...fieldA11y('aula-video', undefined, true)}
            value={videoUrl}
            onChange={(evento) => setVideoUrl(evento.target.value)}
            placeholder="https://www.youtube.com/watch?v=..."
          />
        </Field>
      </div>

      <label className="mt-4 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4 accent-[var(--color-accent)]"
          checked={isPublished}
          onChange={(evento) => setIsPublished(evento.target.checked)}
        />
        Publicar para as oficinas
      </label>

      <DialogFooter>
        <Button variant="secondary" onClick={onCancelar}>
          Cancelar
        </Button>
        <Button
          loading={salvando}
          onClick={() => {
            if (!title.trim() || !slug.trim()) {
              toast.error('Título e apelido são obrigatórios.');
              return;
            }
            const segundos = duracao.trim() ? Number(duracao.replace(/\D/g, '')) : null;
            onSalvar({
              module,
              slug: slug.trim(),
              title: title.trim(),
              description: description.trim(),
              player,
              videoUrl: videoUrl.trim() || null,
              durationSeconds: Number.isFinite(segundos) ? segundos : null,
              position: Number(position.replace(/\D/g, '')) || 0,
              isPublished,
            });
          }}
        >
          Salvar
        </Button>
      </DialogFooter>
    </>
  );
}
