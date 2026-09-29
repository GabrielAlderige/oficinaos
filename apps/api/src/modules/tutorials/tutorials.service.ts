import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm';
import {
  type CreateTutorialLessonInput,
  TUTORIAL_MODULE_HINTS,
  TUTORIAL_MODULE_LABELS,
  TUTORIAL_MODULES,
  type TutorialLesson,
  type TutorialModule,
  type TutorialOverview,
  type TutorialPlayer,
  type UpdateTutorialLessonInput,
} from '@oficinaos/shared';
import { recordActivity } from '../../core/audit';
import type { AuthContext, ClientInfo, ServiceDeps } from '../../core/auth-context';
import { notFound, validationFailed } from '../../core/errors';
import { tutorialLessons, tutorialViews } from '../../db/schema';
import { withoutTenant, withTenant } from '../../db/tenant';

type LessonRow = typeof tutorialLessons.$inferSelect;

/**
 * O endereço que entra no `<iframe>`.
 *
 * O painel roda com CSP e o YouTube/Vimeo só aceitam embed pelo domínio de
 * incorporação — colar o link da barra de endereços dá tela cinza. Converter
 * aqui, e não na tela, mantém a regra num lugar só e deixa o admin colar o
 * link que ele tem na mão.
 */
export function embedDoVideo(player: TutorialPlayer, url: string | null): string | null {
  if (!url) return null;
  try {
    const endereco = new URL(url);
    if (player === 'YOUTUBE') {
      // youtu.be/ID, /watch?v=ID, /embed/ID e /shorts/ID
      const id =
        endereco.hostname.endsWith('youtu.be')
          ? endereco.pathname.slice(1)
          : (endereco.searchParams.get('v') ??
            (/^\/(embed|shorts)\//.test(endereco.pathname) ? endereco.pathname.split('/')[2] : null));
      return id ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?rel=0` : null;
    }
    if (player === 'VIMEO') {
      const id = endereco.pathname.split('/').filter(Boolean).pop();
      return id ? `https://player.vimeo.com/video/${encodeURIComponent(id)}` : null;
    }
    return url;
  } catch {
    return null;
  }
}

/**
 * Tutoriais em vídeo (E39).
 *
 * As aulas são da PLATAFORMA — todas as oficinas veem as mesmas. Quem lê é
 * qualquer pessoa logada, **sem permissão**: o mecânico precisa aprender tanto
 * quanto o dono, e exigir papel aqui seria trancar o manual. Quem escreve é
 * administrador da plataforma.
 *
 * Aula sem vídeo não é publicável (o banco recusa): listar título sem vídeo
 * faria a oficina clicar numa tela preta e concluir que o sistema quebrou.
 */
export class TutorialsService {
  constructor(private readonly deps: ServiceDeps) {}

  private toDto(linha: LessonRow, visto: boolean): TutorialLesson {
    return {
      id: linha.id,
      module: linha.module as TutorialModule,
      slug: linha.slug,
      title: linha.title,
      description: linha.description,
      player: linha.player as TutorialPlayer,
      videoUrl: linha.videoUrl,
      embedUrl: embedDoVideo(linha.player as TutorialPlayer, linha.videoUrl),
      durationSeconds: linha.durationSeconds,
      position: linha.position,
      isPublished: linha.publishedAt !== null,
      watched: visto,
    };
  }

  /**
   * O que a oficina vê: só aula publicada, agrupada por módulo na ordem fixa.
   * Módulo sem aula publicada **não aparece** — seção vazia é promessa por
   * cumprir.
   */
  async overview(auth: AuthContext, incluirRascunhos = false): Promise<TutorialOverview> {
    const linhas = await withoutTenant(this.deps.db, async (tx) =>
      tx
        .select()
        .from(tutorialLessons)
        .where(incluirRascunhos ? undefined : isNotNull(tutorialLessons.publishedAt))
        .orderBy(asc(tutorialLessons.position), asc(tutorialLessons.title)),
    );

    const vistos = await withTenant(this.deps.db, auth, async (tx) => {
      if (!linhas.length) return new Set<string>();
      const marcas = await tx
        .select({ lessonId: tutorialViews.lessonId })
        .from(tutorialViews)
        .where(
          and(
            eq(tutorialViews.userId, auth.userId),
            inArray(
              tutorialViews.lessonId,
              linhas.map((l) => l.id),
            ),
          ),
        );
      return new Set(marcas.map((m) => m.lessonId));
    });

    const aulas = linhas.map((linha) => this.toDto(linha, vistos.has(linha.id)));
    const modules = TUTORIAL_MODULES.map((module) => {
      const doModulo = aulas.filter((a) => a.module === module);
      return {
        module,
        label: TUTORIAL_MODULE_LABELS[module],
        hint: TUTORIAL_MODULE_HINTS[module],
        lessons: doModulo,
        watchedCount: doModulo.filter((a) => a.watched).length,
      };
    }).filter((m) => m.lessons.length > 0);

    const emOrdem = modules.flatMap((m) => m.lessons);
    return {
      modules,
      totalLessons: emOrdem.length,
      watchedLessons: emOrdem.filter((a) => a.watched).length,
      nextLessonId: emOrdem.find((a) => !a.watched)?.id ?? null,
    };
  }

  /** "Já vi esta aula" é por PESSOA: o dono ter visto não marca o mecânico. */
  async setWatched(auth: AuthContext, lessonId: string, watched: boolean): Promise<TutorialOverview> {
    const [aula] = await withoutTenant(this.deps.db, async (tx) =>
      tx.select({ id: tutorialLessons.id }).from(tutorialLessons).where(eq(tutorialLessons.id, lessonId)).limit(1),
    );
    if (!aula) throw notFound('Aula não encontrada');

    await withTenant(this.deps.db, auth, async (tx) => {
      if (watched) {
        await tx
          .insert(tutorialViews)
          .values({ organizationId: auth.organizationId, userId: auth.userId, lessonId })
          .onConflictDoNothing();
      } else {
        await tx
          .delete(tutorialViews)
          .where(and(eq(tutorialViews.userId, auth.userId), eq(tutorialViews.lessonId, lessonId)));
      }
    });
    return this.overview(auth);
  }

  // ------------------------- administração da plataforma -------------------

  async create(auth: AuthContext, input: CreateTutorialLessonInput, client: ClientInfo): Promise<TutorialLesson> {
    this.conferirPublicacao(input.isPublished, input.videoUrl);
    const linha = await withoutTenant(this.deps.db, async (tx) => {
      const [criada] = await tx
        .insert(tutorialLessons)
        .values({
          module: input.module,
          slug: input.slug,
          title: input.title,
          description: input.description,
          player: input.player,
          videoUrl: input.videoUrl,
          durationSeconds: input.durationSeconds,
          position: input.position,
          publishedAt: input.isPublished ? new Date() : null,
          createdBy: auth.userId,
        })
        .returning();
      return criada!;
    });
    await withTenant(this.deps.db, auth, async (tx) => {
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'tutorial.lesson_created',
        entityType: 'tutorial_lesson',
        entityId: linha.id,
        ip: client.ip,
        userAgent: client.userAgent,
      });
    });
    return this.toDto(linha, false);
  }

  async update(
    auth: AuthContext,
    lessonId: string,
    input: UpdateTutorialLessonInput,
    client: ClientInfo,
  ): Promise<TutorialLesson> {
    const linha = await withoutTenant(this.deps.db, async (tx) => {
      const [atual] = await tx.select().from(tutorialLessons).where(eq(tutorialLessons.id, lessonId)).limit(1);
      if (!atual) throw notFound('Aula não encontrada');

      // `videoUrl` que não veio no PATCH é a que já está gravada
      const videoFinal = input.videoUrl === undefined ? atual.videoUrl : input.videoUrl;
      const publicarAgora = input.isPublished ?? atual.publishedAt !== null;
      this.conferirPublicacao(publicarAgora, videoFinal);

      const [salva] = await tx
        .update(tutorialLessons)
        .set({
          ...(input.module !== undefined && { module: input.module }),
          ...(input.slug !== undefined && { slug: input.slug }),
          ...(input.title !== undefined && { title: input.title }),
          ...(input.description !== undefined && { description: input.description }),
          ...(input.player !== undefined && { player: input.player }),
          ...(input.videoUrl !== undefined && { videoUrl: input.videoUrl }),
          ...(input.durationSeconds !== undefined && { durationSeconds: input.durationSeconds }),
          ...(input.position !== undefined && { position: input.position }),
          ...(input.isPublished !== undefined && {
            publishedAt: input.isPublished ? (atual.publishedAt ?? new Date()) : null,
          }),
        })
        .where(eq(tutorialLessons.id, lessonId))
        .returning();
      return salva!;
    });
    await withTenant(this.deps.db, auth, async (tx) => {
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'tutorial.lesson_updated',
        entityType: 'tutorial_lesson',
        entityId: lessonId,
        ip: client.ip,
        userAgent: client.userAgent,
      });
    });
    return this.toDto(linha, false);
  }

  async remove(auth: AuthContext, lessonId: string, client: ClientInfo): Promise<void> {
    await withoutTenant(this.deps.db, async (tx) => {
      const apagadas = await tx.delete(tutorialLessons).where(eq(tutorialLessons.id, lessonId)).returning();
      if (!apagadas.length) throw notFound('Aula não encontrada');
    });
    await withTenant(this.deps.db, auth, async (tx) => {
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'tutorial.lesson_deleted',
        entityType: 'tutorial_lesson',
        entityId: lessonId,
        ip: client.ip,
        userAgent: client.userAgent,
      });
    });
  }

  /**
   * Publicar sem vídeo é o erro que estraga a experiência: a oficina abre e
   * não há o que assistir. O banco também recusa, mas aqui a mensagem explica.
   */
  private conferirPublicacao(publicar: boolean, videoUrl: string | null | undefined): void {
    if (publicar && !videoUrl) {
      throw validationFailed([
        { path: 'videoUrl', message: 'Cole o endereço do vídeo antes de publicar a aula' },
      ]);
    }
  }
}
