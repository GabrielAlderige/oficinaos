import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ExtendTrialInput,
  PlatformOrganization,
  PlatformOverview,
  Prospect,
  ProspectsOverview,
} from '@oficinaos/shared';
import { api } from '../../lib/api-client';
import { tokenStore } from '../../lib/auth';

/** A área da plataforma sobre as oficinas (E41). Só para `is_platform_admin`. */
export const platformKeys = {
  organizations: ['platform', 'organizations'] as const,
};

export function usePlatformOrganizations() {
  return useQuery({
    queryKey: platformKeys.organizations,
    queryFn: () => api<PlatformOverview>('/platform/organizations'),
  });
}

export function useExtendTrial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: ExtendTrialInput & { id: string }) =>
      api<PlatformOrganization>(`/platform/organizations/${id}/extend-trial`, { method: 'POST', json: body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: platformKeys.organizations }),
  });
}

// ------------------------- interessados do site (E42) -----------------------

export const prospectKeys = { all: ['platform', 'prospects'] as const };

export function useProspects() {
  return useQuery({
    queryKey: prospectKeys.all,
    queryFn: () => api<ProspectsOverview>('/prospects'),
  });
}

export function useMarkProspect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, contacted }: { id: string; contacted: boolean }) =>
      api<Prospect>(`/prospects/${id}`, { method: 'PATCH', json: { contacted } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: prospectKeys.all }),
  });
}

/**
 * A planilha do remarketing.
 *
 * Precisa de `fetch` cru, como o download dos relatórios: a rota exige o token
 * de administrador da plataforma, e `window.open` não manda cabeçalho nenhum —
 * abriria uma aba com 401 em vez de baixar o arquivo.
 */
export function useDownloadProspects() {
  return useMutation({
    mutationFn: async () => {
      const token = tokenStore.get();
      const resposta = await fetch('/api/v1/prospects/csv', {
        headers: token ? { authorization: `Bearer ${token}` } : {},
        credentials: 'same-origin',
      });
      if (!resposta.ok) throw new Error('Não foi possível gerar a planilha agora.');
      const nome =
        /filename="([^"]+)"/.exec(resposta.headers.get('content-disposition') ?? '')?.[1] ?? 'interessados.csv';
      const blob = await resposta.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = nome;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      return nome;
    },
  });
}
