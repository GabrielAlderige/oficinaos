import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateTutorialLessonInput,
  TutorialLesson,
  TutorialOverview,
  UpdateTutorialLessonInput,
} from '@oficinaos/shared';
import { api } from '../../lib/api-client';

/** Tutoriais em vídeo (E39): conteúdo da plataforma, progresso de cada pessoa. */
export const tutorialKeys = {
  all: ['tutorials'] as const,
  oficina: ['tutorials', 'oficina'] as const,
  admin: ['tutorials', 'admin'] as const,
};

export function useTutorials() {
  return useQuery({ queryKey: tutorialKeys.oficina, queryFn: () => api<TutorialOverview>('/tutorials') });
}

export function useSetWatched() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, watched }: { id: string; watched: boolean }) =>
      api<TutorialOverview>(`/tutorials/${id}/visto`, { method: 'PUT', json: { watched } }),
    // a resposta já é a visão inteira: escrever no cache evita o piscar da lista
    onSuccess: (visao) => qc.setQueryData(tutorialKeys.oficina, visao),
  });
}

// --------------------------- plataforma ------------------------------------

export function useTutorialsAdmin() {
  return useQuery({ queryKey: tutorialKeys.admin, queryFn: () => api<TutorialOverview>('/tutorials/admin') });
}

export function useCreateLesson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateTutorialLessonInput) =>
      api<TutorialLesson>('/tutorials/admin', { method: 'POST', json: body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: tutorialKeys.all }),
  });
}

export function useUpdateLesson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateTutorialLessonInput & { id: string }) =>
      api<TutorialLesson>(`/tutorials/admin/${id}`, { method: 'PATCH', json: body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: tutorialKeys.all }),
  });
}

export function useDeleteLesson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<{ ok: true }>(`/tutorials/admin/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: tutorialKeys.all }),
  });
}
