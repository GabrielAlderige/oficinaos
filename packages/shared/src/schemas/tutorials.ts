import { z } from 'zod';
import { TUTORIAL_MODULES, TUTORIAL_PLAYERS } from '../enums/tutorials';

/**
 * Tutoriais em vídeo (E39) — conteúdo da PLATAFORMA.
 *
 * Como a ficha do carro: o dado não é de nenhuma oficina, todas veem o mesmo,
 * e quem escreve é administrador da plataforma. A aula nasce **rascunho** e
 * só aparece quando publicada — aula listada sem vídeo faz a oficina clicar
 * numa tela preta e concluir que o sistema está quebrado.
 *
 * O que É de cada oficina é o progresso: quem já assistiu o quê.
 */

/** O endereço tem de ser https: o painel roda em https e o navegador recusa embed em http. */
const videoUrl = z
  .url('Cole o endereço do vídeo')
  .max(500)
  .refine((v) => v.startsWith('https://'), 'O endereço precisa começar com https://');

export const tutorialLessonFieldsSchema = z.object({
  module: z.enum(TUTORIAL_MODULES),
  /** aparece no endereço e no "continuar de onde parei"; minúsculas e hífen */
  slug: z
    .string()
    .trim()
    .min(3, 'O apelido da aula precisa de ao menos 3 letras')
    .max(80)
    .regex(/^[a-z0-9-]+$/, 'Use só letras minúsculas, números e hífen'),
  title: z.string().trim().min(3, 'Escreva o título da aula').max(120),
  /** uma frase dizendo o que a pessoa sai sabendo */
  description: z.string().trim().max(300).default(''),
  player: z.enum(TUTORIAL_PLAYERS).default('YOUTUBE'),
  videoUrl: videoUrl.nullable().default(null),
  durationSeconds: z.number().int().min(0).max(36_000).nullable().default(null),
  /** ordem dentro do módulo; empate cai para o título */
  position: z.number().int().min(0).max(999).default(0),
});

export const createTutorialLessonSchema = tutorialLessonFieldsSchema.extend({
  isPublished: z.boolean().default(false),
});
export type CreateTutorialLessonInput = z.infer<typeof createTutorialLessonSchema>;

/**
 * Atualização com os campos OPCIONAIS e sem padrão — a mesma armadilha do
 * catálogo de veículos: `.partial()` mantém o `.default()` de dentro, e um
 * PATCH de `{ isPublished: true }` chegaria ao serviço apagando a `videoUrl`.
 */
export const updateTutorialLessonSchema = z.object({
  module: z.enum(TUTORIAL_MODULES).optional(),
  slug: z
    .string()
    .trim()
    .min(3)
    .max(80)
    .regex(/^[a-z0-9-]+$/, 'Use só letras minúsculas, números e hífen')
    .optional(),
  title: z.string().trim().min(3).max(120).optional(),
  description: z.string().trim().max(300).optional(),
  player: z.enum(TUTORIAL_PLAYERS).optional(),
  videoUrl: videoUrl.nullable().optional(),
  durationSeconds: z.number().int().min(0).max(36_000).nullable().optional(),
  position: z.number().int().min(0).max(999).optional(),
  isPublished: z.boolean().optional(),
});
export type UpdateTutorialLessonInput = z.infer<typeof updateTutorialLessonSchema>;

export const tutorialLessonSchema = z.object({
  id: z.uuid(),
  module: z.enum(TUTORIAL_MODULES),
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  player: z.enum(TUTORIAL_PLAYERS),
  videoUrl: z.string().nullable(),
  /** o endereço pronto para o `<iframe>`, montado na API a partir do player */
  embedUrl: z.string().nullable(),
  durationSeconds: z.number().nullable(),
  position: z.number(),
  isPublished: z.boolean(),
  /** só de quem está pedindo: progresso é por pessoa, não por oficina */
  watched: z.boolean(),
});
export type TutorialLesson = z.infer<typeof tutorialLessonSchema>;

export const tutorialModuleSchema = z.object({
  module: z.enum(TUTORIAL_MODULES),
  label: z.string(),
  hint: z.string(),
  lessons: z.array(tutorialLessonSchema),
  watchedCount: z.number(),
});
export type TutorialModuleGroup = z.infer<typeof tutorialModuleSchema>;

export const tutorialOverviewSchema = z.object({
  modules: z.array(tutorialModuleSchema),
  totalLessons: z.number(),
  watchedLessons: z.number(),
  /** a próxima aula não assistida, para o botão "continuar" */
  nextLessonId: z.uuid().nullable(),
});
export type TutorialOverview = z.infer<typeof tutorialOverviewSchema>;

export const setWatchedSchema = z.object({ watched: z.boolean() });
export type SetWatchedInput = z.infer<typeof setWatchedSchema>;
