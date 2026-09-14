import { describe, expect, it } from 'vitest';
import { ROLES } from './enums/roles';
import { can, canManageRole, PERMISSIONS, ROLE_PERMISSIONS } from './permissions';

describe('matriz de permissões', () => {
  it('só usa permissões que existem', () => {
    for (const role of ROLES) {
      for (const permission of ROLE_PERMISSIONS[role]) {
        expect(PERMISSIONS).toContain(permission);
      }
    }
  });

  it('OWNER pode tudo; ADMIN pode tudo menos cobrança', () => {
    expect(ROLE_PERMISSIONS.OWNER).toEqual(PERMISSIONS);
    expect(can('ADMIN', 'billing:manage')).toBe(false);
    expect(ROLE_PERMISSIONS.ADMIN).toHaveLength(PERMISSIONS.length - 1);
  });

  it('mecânico não acessa financeiro, custo, equipe nem desconto', () => {
    for (const p of [
      'finance:read',
      'parts:view_cost',
      'team:manage',
      'work_orders:discount',
      'quotes:send',
      'customers:view_contact',
      'customers:write',
    ] as const) {
      expect(can('MECHANIC', p), p).toBe(false);
    }
    expect(can('MECHANIC', 'work_orders:change_status')).toBe(true);
  });

  it('atendente registra pagamento mas não vê o financeiro', () => {
    expect(can('ATTENDANT', 'payments:record')).toBe(true);
    expect(can('ATTENDANT', 'finance:read')).toBe(false);
    expect(can('ATTENDANT', 'dashboard:view_financial')).toBe(false);
  });

  it('só gerente para cima cancela OS e dá desconto ilimitado', () => {
    for (const role of ['OWNER', 'ADMIN', 'MANAGER'] as const) expect(can(role, 'work_orders:cancel')).toBe(true);
    for (const role of ['ATTENDANT', 'MECHANIC', 'FINANCE'] as const) {
      expect(can(role, 'work_orders:discount_unlimited')).toBe(false);
    }
  });

  it('fornecedor: gerente cadastra, atendente e financeiro consultam, mecânico não vê', () => {
    for (const role of ['OWNER', 'ADMIN', 'MANAGER'] as const) {
      expect(can(role, 'suppliers:write'), role).toBe(true);
    }
    // o atendente liga atrás de peça e o financeiro paga: os dois precisam do contato
    for (const role of ['ATTENDANT', 'FINANCE'] as const) {
      expect(can(role, 'suppliers:read'), role).toBe(true);
      expect(can(role, 'suppliers:write'), role).toBe(false);
    }
    expect(can('MECHANIC', 'suppliers:read')).toBe(false);
  });

  it('cotação: atendente pede mas não vê preço nem escolhe; mecânico não participa', () => {
    expect(can('ATTENDANT', 'supplier_quotes:send')).toBe(true);
    // preço de fornecedor é custo: a regra da E4 continua valendo aqui
    expect(can('ATTENDANT', 'parts:view_cost')).toBe(false);
    expect(can('ATTENDANT', 'supplier_quotes:award')).toBe(false);
    for (const role of ['OWNER', 'ADMIN', 'MANAGER'] as const) {
      expect(can(role, 'supplier_quotes:award'), role).toBe(true);
    }
    expect(can('MECHANIC', 'supplier_quotes:send')).toBe(false);
    expect(can('FINANCE', 'supplier_quotes:award')).toBe(false);
  });

  it('só OWNER mexe em OWNER', () => {
    expect(canManageRole('OWNER', 'OWNER')).toBe(true);
    expect(canManageRole('ADMIN', 'OWNER')).toBe(false);
    expect(canManageRole('ADMIN', 'MECHANIC')).toBe(true);
    expect(canManageRole('MANAGER', 'MECHANIC')).toBe(false);
  });
});
