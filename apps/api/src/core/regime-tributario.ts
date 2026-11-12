import { eq } from 'drizzle-orm';
import { isValidCnpj, normalizeCnpj } from '@oficinaos/shared';
import { organizations } from '../db/schema';
import { withTenant } from '../db/tenant';
import * as fiscalRepo from '../modules/invoices/invoices.repository';
import type { AuthContext, ServiceDeps } from './auth-context';

/** Depois de uma consulta sem resposta, só tenta de novo no dia seguinte (a não ser que peçam). */
const ESPERA_ENTRE_CONSULTAS_MS = 24 * 60 * 60 * 1000;

export type ResultadoDaConsulta = 'ATUALIZADO' | 'SEM_RESPOSTA' | 'SEM_CNPJ' | 'NAO_PRECISOU';

/**
 * Descobre o regime tributário pelo CNPJ do cadastro da oficina (E51).
 *
 * Sem `forcar`, só consulta quando a oficina ainda NÃO tem regime — quem
 * escolheu à mão não é desmentido pela Receita, que está com dois anos de
 * atraso no Lucro Presumido/Real. Com `forcar` (o botão "Consultar na
 * Receita"), consulta e grava o que vier.
 *
 * A rede fica FORA da transação: transação aberta esperando a Receita é o
 * jeito mais rápido de travar o banco.
 */
export async function regimePelaReceita(
  deps: ServiceDeps,
  auth: AuthContext,
  { forcar }: { forcar: boolean },
): Promise<ResultadoDaConsulta> {
  const estado = await withTenant(deps.db, auth, async (tx) => {
    const [org] = await tx
      .select({ document: organizations.document })
      .from(organizations)
      .where(eq(organizations.id, auth.organizationId))
      .limit(1);
    return { documento: org?.document ?? null, fiscal: await fiscalRepo.findFiscalSettings(tx, auth.organizationId) };
  });

  const cnpj = estado.documento ? normalizeCnpj(estado.documento) : '';
  if (!isValidCnpj(cnpj)) return 'SEM_CNPJ';
  if (!forcar) {
    if (estado.fiscal?.taxRegime) return 'NAO_PRECISOU';
    const ultima = estado.fiscal?.taxRegimeCheckedAt?.getTime() ?? 0;
    if (Date.now() - ultima < ESPERA_ENTRE_CONSULTAS_MS) return 'NAO_PRECISOU';
  }

  const resposta = await deps.consultaCnpj(cnpj);
  await withTenant(deps.db, auth, (tx) =>
    fiscalRepo.upsertFiscalSettings(tx, auth.organizationId, {
      taxRegimeCheckedAt: new Date(),
      taxRegimeDetail: resposta?.detail ?? 'Não foi possível consultar a Receita agora; tente de novo mais tarde.',
      ...(resposta?.regime ? { taxRegime: resposta.regime, taxRegimeSource: 'RECEITA' as const } : {}),
    }),
  );
  return resposta?.regime ? 'ATUALIZADO' : 'SEM_RESPOSTA';
}
