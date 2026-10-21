import { and, eq, isNull, sql } from 'drizzle-orm';
import { TRIAL_DAYS } from '@oficinaos/shared';
import { subscriptions } from '../../db/schema';
import type { Tx } from '../../db/tenant';

/**
 * Dá a partida no teste de 30 dias (D92), se ele ainda não começou.
 *
 * Chamado nos dois momentos em que o sistema passa a valer para a oficina: o
 * primeiro orçamento enviado e a implantação marcada como feita pela equipe.
 * O que vier primeiro ganha; o segundo não muda nada (`trial_started_at` já
 * preenchido).
 *
 * O fim só ENCURTA (`least`): o cadastro gravou o fim do caso em que o teste
 * começa sozinho no 15º dia, e quem manda o primeiro orçamento depois disso já
 * estava em teste desde então — o início gravado é o real, não o do orçamento.
 *
 * Quem já assinou no teste não tem o fim encurtado: a primeira fatura foi
 * criada no gateway para o fim gravado. Encurtar aqui travava a oficina no fim
 * do teste novo + carência, dias ANTES de a fatura dela sequer vencer.
 *
 * Roda dentro da transação de quem chamou: o orçamento e a partida do teste
 * ficam juntos ou não ficam. Quem chamou limpa o cache da assinatura depois
 * do commit, quando a função devolve `true`.
 */
export async function iniciarTeste(tx: Tx, organizationId: string, agora: Date = new Date()): Promise<boolean> {
  const daquiATrintaDias = new Date(agora.getTime() + TRIAL_DAYS * 86_400_000);
  const linhas = await tx
    .update(subscriptions)
    .set({
      trialEndsAt: sql`case when ${subscriptions.providerSubscriptionId} is null
        then least(${subscriptions.trialEndsAt}, ${daquiATrintaDias})
        else ${subscriptions.trialEndsAt} end`,
      trialStartedAt: sql`least(${agora}::timestamptz, ${subscriptions.trialEndsAt} - make_interval(days => ${TRIAL_DAYS}))`,
    })
    .where(
      and(
        eq(subscriptions.organizationId, organizationId),
        eq(subscriptions.status, 'TRIALING'),
        isNull(subscriptions.trialStartedAt),
      ),
    )
    .returning({ id: subscriptions.id });
  return linhas.length > 0;
}
