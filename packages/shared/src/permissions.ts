import type { Role } from './enums/roles';

/**
 * Permissões do sistema (docs/ARCHITECTURE.md §7). A API barra por elas; o
 * painel usa a mesma matriz para esconder menus e botões. Quem garante é a API.
 */
export const PERMISSIONS = [
  'dashboard:view',
  'dashboard:view_financial',
  'customers:read',
  /** telefone, documento, e-mail e endereço sem máscara (o mecânico não tem) */
  'customers:view_contact',
  'customers:write',
  'customers:delete',
  'vehicles:write',
  'vehicles:delete',
  'appointments:read',
  'appointments:write',
  'work_orders:read',
  'work_orders:write',
  'work_orders:change_status',
  /**
   * Entregar o veículo. Permissão própria porque o mecânico muda status
   * (diagnóstico, execução, finalizar) mas NÃO entrega o carro (§7, nota 4), e
   * os guards verificam permissão, nunca papel.
   */
  'work_orders:deliver',
  'work_orders:cancel',
  'work_orders:reopen',
  'work_orders:discount',
  'work_orders:discount_unlimited',
  'work_orders:edit_approved',
  'quotes:send',
  'quotes:record_manual_approval',
  'catalog:read',
  'catalog:write',
  /** fornecedores (MVP 2): a cadeia da peça começa aqui */
  'suppliers:read',
  'suppliers:write',
  /** pedir preço a fornecedores por link (E11); VER o preço é `parts:view_cost` */
  'supplier_quotes:send',
  /** escolher a oferta vencedora: grava custo na OS, então é do gerente para cima */
  'supplier_quotes:award',
  /**
   * compras (E12): ver pedidos e recebimentos (o financeiro paga na E13) e
   * criar, pedir, receber e devolver — que mexem em estoque e custo
   */
  'purchases:read',
  'purchases:write',
  'parts:view_cost',
  'inventory:read',
  'inventory:adjust',
  'payments:record',
  'payments:cancel',
  /**
   * cobrança online (V3, E19): mandar o Pix/boleto é trabalho de balcão, mas
   * ESTORNAR é devolver dinheiro — fica com quem já cancela pagamento
   */
  'charges:create',
  'charges:refund',
  'finance:read',
  'finance:write',
  'reports:read',
  /**
   * nota fiscal (V3, E18): ver é uma coisa, emitir é outra, e CANCELAR é a
   * mais séria das três — a prefeitura dá prazo curto e o cancelamento
   * indevido dá dor de cabeça com o contador
   */
  'invoices:read',
  'invoices:issue',
  'invoices:cancel',
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
    'customers:view_contact',
    'customers:write',
    'customers:delete',
    'vehicles:write',
    'vehicles:delete',
    'appointments:read',
    'appointments:write',
    'work_orders:read',
    'work_orders:write',
    'work_orders:change_status',
    'work_orders:deliver',
    'work_orders:cancel',
    'work_orders:reopen',
    'work_orders:discount',
    'work_orders:discount_unlimited',
    'work_orders:edit_approved',
    'quotes:send',
    'quotes:record_manual_approval',
    'catalog:read',
    'catalog:write',
    'suppliers:read',
    'suppliers:write',
    'supplier_quotes:send',
    'supplier_quotes:award',
    'purchases:read',
    'purchases:write',
    'parts:view_cost',
    'inventory:read',
    'inventory:adjust',
    'payments:record',
    'finance:read',
    'reports:read',
    'invoices:read',
    'invoices:issue',
    'invoices:cancel',
    'charges:create',
    'charges:refund',
  ],
  ATTENDANT: [
    'dashboard:view',
    'customers:read',
    'customers:view_contact',
    'customers:write',
    'vehicles:write',
    'appointments:read',
    'appointments:write',
    'work_orders:read',
    'work_orders:write',
    'work_orders:change_status',
    'work_orders:deliver',
    'work_orders:discount',
    'quotes:send',
    'quotes:record_manual_approval',
    'catalog:read',
    // é quem liga atrás de peça: precisa do contato do fornecedor, não de mexer no cadastro
    'suppliers:read',
    // pede a cotação, mas não vê o preço (é custo) nem escolhe — decisão de 14/09/2026
    'supplier_quotes:send',
    'inventory:read',
    // o atendente costuma ser o caixa: registra o pagamento, mas não vê o financeiro
    'payments:record',
    // é ele que entrega o carro e ouve "me dá a nota"; cancelar, não
    'invoices:read',
    'invoices:issue',
    // manda o Pix na hora de fechar a conta; estornar é de outro nível
    'charges:create',
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
    // cobrança precisa do contato
    'customers:view_contact',
    'work_orders:read',
    'catalog:read',
    // quem paga o fornecedor precisa do cadastro dele e do que foi comprado
    'suppliers:read',
    'purchases:read',
    'parts:view_cost',
    'inventory:read',
    'payments:record',
    'payments:cancel',
    'finance:read',
    'finance:write',
    'reports:read',
    'invoices:read',
    'invoices:issue',
    'invoices:cancel',
    'charges:create',
    'charges:refund',
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
