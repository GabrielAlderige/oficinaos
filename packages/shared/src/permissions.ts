import type { Role } from './enums/roles';

/**
 * Permissões do sistema (docs/ARCHITECTURE.md §7). A API barra por elas; o
 * painel usa a mesma matriz para esconder menus e botões. Quem garante é a API.
 */
export const PERMISSIONS = [
  'dashboard:view',
  'dashboard:view_financial',
  'customers:read',
  'customers:write',
  'customers:delete',
  'vehicles:write',
  'vehicles:delete',
  'appointments:read',
  'appointments:write',
  'work_orders:read',
  'work_orders:write',
  'work_orders:change_status',
  'work_orders:cancel',
  'work_orders:reopen',
  'work_orders:discount',
  'work_orders:discount_unlimited',
  'work_orders:edit_approved',
  'quotes:send',
  'quotes:record_manual_approval',
  'catalog:read',
  'catalog:write',
  'parts:view_cost',
  'inventory:read',
  'inventory:adjust',
  'payments:record',
  'payments:cancel',
  'finance:read',
  'finance:write',
  'reports:read',
  'team:manage',
  'organization:manage',
  'audit:read',
  'billing:manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const without = (...excluded: Permission[]): readonly Permission[] =>
  PERMISSIONS.filter((permission) => !excluded.includes(permission));

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  OWNER: PERMISSIONS,
  ADMIN: without('billing:manage'),
  MANAGER: [
    'dashboard:view',
    'dashboard:view_financial',
    'customers:read',
    'customers:write',
    'customers:delete',
    'vehicles:write',
    'vehicles:delete',
    'appointments:read',
    'appointments:write',
    'work_orders:read',
    'work_orders:write',
    'work_orders:change_status',
    'work_orders:cancel',
    'work_orders:reopen',
    'work_orders:discount',
    'work_orders:discount_unlimited',
    'work_orders:edit_approved',
    'quotes:send',
    'quotes:record_manual_approval',
    'catalog:read',
    'catalog:write',
    'parts:view_cost',
    'inventory:read',
    'inventory:adjust',
    'payments:record',
    'finance:read',
    'reports:read',
  ],
  ATTENDANT: [
    'dashboard:view',
    'customers:read',
    'customers:write',
    'vehicles:write',
    'appointments:read',
    'appointments:write',
    'work_orders:read',
    'work_orders:write',
    'work_orders:change_status',
    'work_orders:discount',
    'quotes:send',
    'quotes:record_manual_approval',
    'catalog:read',
    'inventory:read',
    // o atendente costuma ser o caixa: registra o pagamento, mas não vê o financeiro
    'payments:record',
  ],
  MECHANIC: [
    'dashboard:view',
    'customers:read',
    'appointments:read',
    'work_orders:read',
    'work_orders:write',
    'work_orders:change_status',
    'catalog:read',
    'inventory:read',
  ],
  FINANCE: [
    'dashboard:view',
    'dashboard:view_financial',
    'customers:read',
    'work_orders:read',
    'catalog:read',
    'parts:view_cost',
    'inventory:read',
    'payments:record',
    'payments:cancel',
    'finance:read',
    'finance:write',
    'reports:read',
  ],
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function permissionsFor(role: Role): Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}

/**
 * Quem gerencia a equipe pode atribuir e alterar papéis, mas só um OWNER
 * mexe em OWNER (promover, rebaixar ou remover).
 */
export function canManageRole(actor: Role, target: Role): boolean {
  if (!can(actor, 'team:manage')) return false;
  return target !== 'OWNER' || actor === 'OWNER';
}
