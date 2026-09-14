import { eq } from 'drizzle-orm';
import {
  DEFAULT_ORGANIZATION_SETTINGS,
  type OrganizationSettings,
  organizationSettingsSchema,
} from '@oficinaos/shared';
import { organizations } from '../db/schema';
import type { Tx } from '../db/tenant';

/**
 * Configurações de preço e estoque da oficina (organizations.settings), com os
 * padrões preenchendo o que ainda não foi configurado. Lida por vários módulos
 * (serviços, peças, e a partir da E5 a OS), por isso mora no core.
 */
export async function readOrganizationSettings(tx: Tx, organizationId: string): Promise<OrganizationSettings> {
  const [row] = await tx
    .select({ settings: organizations.settings })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  const stored = organizationSettingsSchema.partial().safeParse(row?.settings ?? {});
  return { ...DEFAULT_ORGANIZATION_SETTINGS, ...(stored.success ? stored.data : {}) };
}

/**
 * O fuso da oficina. Tudo que vira data na tela ou em mensagem passa por aqui —
 * agenda (E8) e recortes do dashboard (E9) usam o mesmo relógio, e não o do
 * servidor (risco R11 em ARCHITECTURE §12).
 */
export async function readTimezone(tx: Tx, organizationId: string): Promise<string> {
  const [row] = await tx
    .select({ timezone: organizations.timezone })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  return row?.timezone ?? 'America/Sao_Paulo';
}
