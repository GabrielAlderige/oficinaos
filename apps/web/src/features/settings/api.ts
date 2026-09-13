import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CalendarColor,
  CreatedInvitation,
  CreateInvitationInput,
  Invitation,
  Member,
  Organization,
  OrganizationForm,
  OrganizationSettings,
  Role,
  SessionInfo,
} from '@oficinaos/shared';
import { api } from '../../lib/api-client';
import { useSession } from '../../lib/session';

// A troca de oficina limpa o cache inteiro (session.tsx), então as chaves não levam o id da oficina.
export const settingsKeys = {
  organization: ['organization'] as const,
  organizationSettings: ['organization-settings'] as const,
  members: ['members'] as const,
  invitations: ['members', 'invitations'] as const,
  sessions: ['auth', 'sessions'] as const,
};

export function useOrganization() {
  return useQuery({ queryKey: settingsKeys.organization, queryFn: () => api<Organization>('/organization') });
}

export function useUpdateOrganization() {
  const queryClient = useQueryClient();
  const { refreshMe } = useSession();
  return useMutation({
    mutationFn: (body: OrganizationForm) => api<Organization>('/organization', { method: 'PATCH', json: body }),
    onSuccess: (organization) => {
      queryClient.setQueryData(settingsKeys.organization, organization);
      void refreshMe(); // nome e fuso aparecem no menu
    },
  });
}

/** Hora técnica e margem padrão: quem monta orçamento lê; quem gerencia a oficina muda. */
export function useOrganizationSettings() {
  return useQuery({
    queryKey: settingsKeys.organizationSettings,
    queryFn: () => api<OrganizationSettings>('/organization/settings'),
  });
}

export function useUpdateOrganizationSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<OrganizationSettings>) =>
      api<OrganizationSettings>('/organization/settings', { method: 'PATCH', json: body }),
    onSuccess: (settings) => {
      queryClient.setQueryData(settingsKeys.organizationSettings, settings);
      // preço dos serviços por hora e preço sugerido das peças dependem daqui
      void queryClient.invalidateQueries({ queryKey: ['services'] });
      void queryClient.invalidateQueries({ queryKey: ['parts'] });
    },
  });
}

export function useMembers() {
  return useQuery({
    queryKey: settingsKeys.members,
    queryFn: async () => (await api<{ data: Member[] }>('/members')).data,
  });
}

export function useInvitations(enabled: boolean) {
  return useQuery({
    queryKey: settingsKeys.invitations,
    queryFn: async () => (await api<{ data: Invitation[] }>('/members/invitations')).data,
    enabled,
  });
}

export function useInvite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateInvitationInput) =>
      api<CreatedInvitation>('/members/invitations', { method: 'POST', json: body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: settingsKeys.invitations }),
  });
}

export function useRevokeInvitation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/members/invitations/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: settingsKeys.invitations }),
  });
}

export function useUpdateMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; role?: Role; isActive?: boolean; calendarColor?: CalendarColor | null }) =>
      api<Member>(`/members/${id}`, { method: 'PATCH', json: body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: settingsKeys.members }),
  });
}

export function useRemoveMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/members/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: settingsKeys.members }),
  });
}

export function useSessions() {
  return useQuery({
    queryKey: settingsKeys.sessions,
    queryFn: async () => (await api<{ data: SessionInfo[] }>('/auth/sessions')).data,
  });
}

export function useRevokeSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/auth/sessions/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: settingsKeys.sessions }),
  });
}
