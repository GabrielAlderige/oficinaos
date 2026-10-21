import { and, eq } from 'drizzle-orm';
import { dayKey, FOUNDER_PLAN, formatBRL } from '@oficinaos/shared';
import { recordActivity } from '../../core/audit';
import type { ServiceDeps } from '../../core/auth-context';
import { lifecycleEmails, plans, subscriptions } from '../../db/schema';
import { withTenant } from '../../db/tenant';
import * as orgRepo from '../organizations/organizations.repository';
import { findPlanByCode, ownerContact, updateSubscription } from './billing.repository';
import { ASSINATURA_DO_EMAIL, dataLocal, horaLocal, primeiroNome } from './ciclo-do-teste';

/**
 * O fim do preço de fundadora (D92): 12 meses de Nitro a R$ 279 contados do
 * fim dos 90 dias grátis. Antes disto o preço ficava gravado, mas a cobrança
 * no Asaas seguia em R$ 279 para sempre, a não ser que alguém lembrasse de
 * trocar à mão.
 *
 * - **30 dias antes:** e-mail ao dono dizendo a data e o valor novo. Mudança de
 *   preço que chega sem aviso é o que faz a pessoa cancelar irritada.
 * - **20 dias antes:** o valor muda no gateway. Tem de ser antes da data
 *   porque o Asaas gera a fatura e manda o "vence em 10 dias" adiantado, com
 *   o valor que estiver na assinatura naquele momento. Só as faturas que
 *   vencem na data ou depois sobem; as de antes são do período combinado.
 *
 * Só vale para quem assinou o Nitro mensal e ainda paga o preço de fundadora.
 * Quem trocou de plano já paga a tabela (`precoComFundadora`), e não há o que
 * reajustar.
 */

const DIA = 86_400_000;
export const AVISO_DA_FUNDADORA_DIAS = 30;
export const REAJUSTE_DA_FUNDADORA_DIAS = 20;

interface AssinaturaDaFundadora {
  status: string;
  providerSubscriptionId: string | null;
  founderPriceCents: number | null;
  founderPriceUntil: Date | null;
  priceCents: number | null;
  billingCycle: string;
  plano: string | null;
}

/** Ainda paga o preço de fundadora, numa assinatura viva no gateway. */
function pagaComoFundadora(a: AssinaturaDaFundadora): a is AssinaturaDaFundadora & { founderPriceUntil: Date } {
  return (
    a.founderPriceCents !== null &&
    a.founderPriceUntil !== null &&
    a.providerSubscriptionId !== null &&
    (a.status === 'ACTIVE' || a.status === 'PAST_DUE') &&
    a.plano === FOUNDER_PLAN &&
    a.billingCycle === 'MONTHLY' &&
    a.priceCents === a.founderPriceCents
  );
}

/** Já é hora de mudar o valor no gateway (inclusive se a data passou e ninguém mudou). */
export function deveReajustar(a: AssinaturaDaFundadora, agora: Date): boolean {
  return pagaComoFundadora(a) && a.founderPriceUntil.getTime() - agora.getTime() <= REAJUSTE_DA_FUNDADORA_DIAS * DIA;
}

/**
 * Já é hora do aviso. Não depende de o valor ainda ser o de fundadora: se o
 * servidor ficou parado na janela do aviso, o reajuste sai na hora dele e o
 * e-mail sai logo depois, antes da data.
 */
export function deveAvisar(a: AssinaturaDaFundadora, agora: Date): boolean {
  if (a.founderPriceCents === null || a.founderPriceUntil === null || a.providerSubscriptionId === null) return false;
  if (a.status !== 'ACTIVE' && a.status !== 'PAST_DUE') return false;
  if (a.plano !== FOUNDER_PLAN || a.billingCycle !== 'MONTHLY') return false;
  const falta = a.founderPriceUntil.getTime() - agora.getTime();
  return falta > 0 && falta <= AVISO_DA_FUNDADORA_DIAS * DIA;
}

export class FimDaFundadora {
  constructor(private readonly deps: ServiceDeps) {}

  private async ler(organizationId: string) {
    return withTenant(this.deps.db, { organizationId }, async (tx) => {
      const [assinatura] = await tx
        .select({
          status: subscriptions.status,
          providerSubscriptionId: subscriptions.providerSubscriptionId,
          founderPriceCents: subscriptions.founderPriceCents,
          founderPriceUntil: subscriptions.founderPriceUntil,
          priceCents: subscriptions.priceCents,
          billingCycle: subscriptions.billingCycle,
          plano: plans.code,
        })
        .from(subscriptions)
        .leftJoin(plans, eq(plans.id, subscriptions.planId))
        .where(eq(subscriptions.organizationId, organizationId))
        .limit(1);
      const tabela = await findPlanByCode(tx, FOUNDER_PLAN);
      const oficina = await orgRepo.findOrganization(tx, organizationId);
      return { assinatura, tabela, oficina };
    });
  }

  /** Muda o valor no gateway, se chegou a hora. Devolve `true` quando mudou. */
  async reajustarSeChegou(organizationId: string, agora = new Date()): Promise<boolean> {
    const { assinatura, tabela, oficina } = await this.ler(organizationId);
    if (!assinatura || !tabela || !oficina || !deveReajustar(assinatura, agora)) return false;

    const aPartirDe = dayKey(assinatura.founderPriceUntil!, oficina.timezone);
    // o gateway é chamado FORA da transação; se falhar, nada muda aqui e a
    // próxima volta tenta de novo (o reajuste no Asaas pode ser repetido)
    const { faturasReajustadas } = await this.deps.gateway.reajustarAssinatura(assinatura.providerSubscriptionId!, {
      amountCents: tabela.priceMonthlyCents,
      aPartirDe,
    });

    await withTenant(this.deps.db, { organizationId }, async (tx) => {
      await updateSubscription(tx, organizationId, { priceCents: tabela.priceMonthlyCents });
      await recordActivity(tx, {
        organizationId,
        actorType: 'SYSTEM',
        actorUserId: null,
        action: 'subscription.founder_price_ended',
        entityType: 'subscription',
        entityId: organizationId,
        metadata: {
          from: assinatura.founderPriceCents,
          to: tabela.priceMonthlyCents,
          aPartirDe,
          faturasReajustadas,
        },
      });
    });
    this.deps.caches.subscriptions.delete(organizationId);
    return true;
  }

  /** Manda o aviso de fim do preço, se for a hora. Devolve `true` quando mandou. */
  async avisarSeDevido(organizationId: string, agora = new Date()): Promise<boolean> {
    if (this.deps.env.NODE_ENV === 'production' && this.deps.email.driver === 'console') return false;
    const { assinatura, tabela, oficina } = await this.ler(organizationId);
    if (!assinatura || !tabela || !oficina || !deveAvisar(assinatura, agora)) return false;
    const hora = horaLocal(agora, oficina.timezone);
    if (hora < 8 || hora >= 20) return false;

    const contato = await withTenant(this.deps.db, { organizationId }, (tx) => ownerContact(tx, organizationId));
    if (!contato) return false;

    // grava antes de enviar: duas voltas ao mesmo tempo não mandam em dobro
    const kind = `FUNDADORA_FIM:${dayKey(assinatura.founderPriceUntil!, oficina.timezone)}`;
    const gravou = await withTenant(this.deps.db, { organizationId }, async (tx) => {
      const linhas = await tx
        .insert(lifecycleEmails)
        .values({ organizationId, kind, sentTo: contato.email })
        .onConflictDoNothing()
        .returning({ id: lifecycleEmails.id });
      return linhas.length > 0;
    });
    if (!gravou) return false;

    const data = dataLocal(assinatura.founderPriceUntil!, oficina.timezone);
    const app = this.deps.env.APP_URL;
    try {
      await this.deps.email.send({
        to: contato.email,
        subject: `Seu preço de fundadora do OficinaOS termina em ${data}`,
        text:
          `Olá, ${primeiroNome(contato.name)}!\n\n` +
          `Os 12 meses com o preço de fundadora da ${oficina.name} terminam em ${data}. ` +
          `A partir da mensalidade que vence nesse dia, o plano ${tabela.name} passa de ` +
          `${formatBRL(assinatura.founderPriceCents!)} para ${formatBRL(tabela.priceMonthlyCents)} por mês, ` +
          'o preço normal do plano.\n\n' +
          'No sistema nada muda: tudo continua funcionando do mesmo jeito. ' +
          'Se preferir outro plano, dá para trocar quando quiser, sem multa:\n' +
          `${app}/configuracoes/plano\n\n` +
          'Obrigado por ter acreditado no OficinaOS desde o começo.' +
          ASSINATURA_DO_EMAIL,
      });
    } catch (erro) {
      this.deps.log.error({ err: erro, organizationId, kind }, 'aviso de fim da fundadora falhou; tenta de novo na próxima volta');
      await withTenant(this.deps.db, { organizationId }, (tx) =>
        tx
          .delete(lifecycleEmails)
          .where(and(eq(lifecycleEmails.organizationId, organizationId), eq(lifecycleEmails.kind, kind))),
      );
      return false;
    }
    return true;
  }
}
