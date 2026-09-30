import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ExtendTrialInput, PlatformOrganization, PlatformOverview } from '@oficinaos/shared';
import { api } from '../../lib/api-client';

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
