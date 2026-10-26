import { ErrorCode } from '@oficinaos/shared';
import { AppError } from '../../core/errors';
import type { Tx } from '../../db/tenant';
import { findPlanLimits } from '../members/members.repository';
import { storageUsedBytes } from './uploads.repository';

const MB = 1024 * 1024;

/** "4,8 GB", "320 MB": o número que o dono lê na mensagem. */
export function formatarEspaco(bytes: number): string {
  if (bytes < 1024 * MB) return `${Math.max(1, Math.round(bytes / MB))} MB`;
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(bytes / (1024 * MB))} GB`;
}

/**
 * O espaço do plano (E46): 5 GB no Turbo, 25 no Supercharger, 100 no Nitro.
 *
 * Estava na landing e na coluna `limits.storageMb` desde o começo e não era
 * conferido em lugar nenhum — o mesmo problema do teto de OS antes da E40.
 * Vale para foto, documento e vídeo, e é conferido no TICKET, com o tamanho
 * que o navegador declarou: o arquivo nem começa a subir se não couber.
 *
 * Dois envios ao mesmo tempo podem passar juntos do teto por um arquivo. É
 * aceito de propósito: o teto protege o disco de abuso, não conta byte a byte.
 */
export async function assertCabeNoEspaco(tx: Tx, organizationId: string, sizeBytes: number): Promise<void> {
  const plano = await findPlanLimits(tx, organizationId);
  const tetoMb = plano?.limits.storageMb ?? null;
  if (tetoMb === null) return;

  const teto = tetoMb * MB;
  const usado = await storageUsedBytes(tx, organizationId);
  if (usado + sizeBytes <= teto) return;

  throw new AppError(
    402,
    ErrorCode.PLAN_LIMIT_REACHED,
    'Espaço do plano cheio',
    `O plano ${plano?.planName} guarda até ${formatarEspaco(teto)} de fotos e vídeos, e a oficina já usa ${formatarEspaco(usado)}. Apague vídeos e fotos que não precisa mais ou suba de plano em Configurações → Plano.`,
  );
}
