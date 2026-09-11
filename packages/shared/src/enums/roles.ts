/** Papéis de um membro dentro de uma oficina (ver docs/ARCHITECTURE.md §7). */
export const ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'MECHANIC', 'ATTENDANT', 'FINANCE'] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: 'Dono',
  ADMIN: 'Administrador',
  MANAGER: 'Gerente',
  MECHANIC: 'Mecânico',
  ATTENDANT: 'Atendente',
  FINANCE: 'Financeiro',
};
