/** Papéis de um membro dentro de uma oficina (ver docs/ARCHITECTURE.md §7). */
export const ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'MECHANIC', 'ATTENDANT', 'FINANCE'] as const;

export type Role = (typeof ROLES)[number];

/** O que cada papel faz, na língua da oficina (tela de convite e equipe). */
export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  OWNER: 'Acesso total, inclusive plano e cobrança.',
  ADMIN: 'Tudo, menos plano e cobrança. Gerencia a equipe e os dados da oficina.',
  MANAGER: 'Toda a operação, descontos, estoque e relatórios. Não mexe na equipe.',
  ATTENDANT: 'Clientes, agenda, orçamentos e recebimento no balcão.',
  MECHANIC: 'Ordens de serviço, diagnóstico, fotos e status. Não vê custos nem financeiro.',
  FINANCE: 'Financeiro, pagamentos e relatórios.',
};

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: 'Dono',
  ADMIN: 'Administrador',
  MANAGER: 'Gerente',
  MECHANIC: 'Mecânico',
  ATTENDANT: 'Atendente',
  FINANCE: 'Financeiro',
};
