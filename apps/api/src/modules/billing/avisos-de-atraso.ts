import { and, eq } from 'drizzle-orm';
import { formatBRL, GRACE_DAYS } from '@oficinaos/shared';
import type { ServiceDeps } from '../../core/auth-context';
import { lifecycleEmails, plans, subscriptions } from '../../db/schema';
import { withTenant } from '../../db/tenant';
import * as orgRepo from '../organizations/organizations.repository';
import { ownerContact } from './billing.repository';
import { ASSINATURA_DO_EMAIL, dataLocal, horaLocal, primeiroNome } from './ciclo-do-teste';

/**
 * Os avisos de que o sistema vai travar (só leitura) por falta de pagamento.
 *
 * O Asaas já manda os e-mails dele sobre o BOLETO (fatura criada, vencendo,
 * vencida, paga). O que ele não sabe é o que acontece com o SISTEMA: que
 * depois de 7 dias de carência a oficina para de conseguir abrir OS. Descobrir
 * isso numa segunda de manhã, com carro no elevador, é como se perde cliente.
 *
 * - `PAGAMENTO_PENDENTE`: a mensalidade venceu sem entrar (só de quem assina).
 * - `TRAVA_EM_2_DIAS`: faltam 2 dias para acabar a carência (de quem assina e
 *   de quem terminou o teste sem assinar).
 * - `SISTEMA_TRAVADO`: acabou; os dados estão lá, e liberar leva 1 minuto.
 *
 * As regras do ciclo do teste valem aqui: grava antes de enviar, um por volta,
 * etapa perdida não sai atrasada, só das 8h às 20h. A diferença é que atraso
 * pode acontecer mais de uma vez na vida da oficina: o tipo gravado leva a
 * data em que a carência começou (`TRAVA_EM_2_DIAS:2026-11-05`), então o
 * atraso de novembro não impede o aviso do atraso de março.
 */

export const ETAPAS_DO_ATRASO = ['PAGAMENTO_PENDENTE', 'TRAVA_EM_2_DIAS', 'SISTEMA_TRAVADO'] as const;
export type EtapaDoAtraso = (typeof ETAPAS_DO_ATRASO)[number];

const DIA = 86_400_000;
const CARENCIA = GRACE_DAYS * DIA;

interface AssinaturaParaAviso {
  status: string;
  trialEndsAt: Date | null;
  pastDueSince: Date | null;
  providerSubscriptionId: string | null;
}

/** Qual aviso vale agora, e desde quando corre a carência (sem olhar o que já foi enviado). */
export function etapaDoAtraso(
  assinatura: AssinaturaParaAviso,
  agora: Date,
): { etapa: EtapaDoAtraso; desde: Date; motivo: 'MENSALIDADE' | 'TESTE' } | null {
  let desde: Date;
  let motivo: 'MENSALIDADE' | 'TESTE';
  if (assinatura.status === 'PAST_DUE' && assinatura.pastDueSince) {
    desde = assinatura.pastDueSince;
    motivo = 'MENSALIDADE';
  } else if (
    (assinatura.status === 'TRIALING' || assinatura.status === 'EXPIRED') &&
    assinatura.trialEndsAt &&
    // quem assinou no teste e não pagou vira PAST_DUE pelo aviso do gateway:
    // é por lá que o atraso dele é contado
    !assinatura.providerSubscriptionId
  ) {
    desde = assinatura.trialEndsAt;
    motivo = 'TESTE';
  } else {
    return null;
  }

  const passou = agora.getTime() - desde.getTime();
  if (passou < 0) return null;
  if (passou < CARENCIA - 2 * DIA) {
    // o fim do teste já tem o e-mail dele (TESTE_ACABOU)
    return motivo === 'MENSALIDADE' ? { etapa: 'PAGAMENTO_PENDENTE', desde, motivo } : null;
  }
  if (passou < CARENCIA) return { etapa: 'TRAVA_EM_2_DIAS', desde, motivo };
  if (passou < CARENCIA + 3 * DIA) return { etapa: 'SISTEMA_TRAVADO', desde, motivo };
  return null;
}

/** O tipo gravado em `lifecycle_emails`: a etapa e o dia em que a carência começou. */
export const tipoGravado = (etapa: EtapaDoAtraso, desde: Date) => `${etapa}:${desde.toISOString().slice(0, 10)}`;

export class AvisosDeAtraso {
  constructor(private readonly deps: ServiceDeps) {}

  /** Manda o aviso devido, se houver. Devolve a etapa enviada (ou `null`). */
  async enviarDevido(organizationId: string, agora = new Date()): Promise<EtapaDoAtraso | null> {
    if (this.deps.env.NODE_ENV === 'production' && this.deps.email.driver === 'console') return null;
    const contexto = await withTenant(this.deps.db, { organizationId }, async (tx) => {
      const oficina = await orgRepo.findOrganization(tx, organizationId);
      const [assinatura] = await tx
        .select({
          status: subscriptions.status,
          trialEndsAt: subscriptions.trialEndsAt,
          pastDueSince: subscriptions.pastDueSince,
          providerSubscriptionId: subscriptions.providerSubscriptionId,
          priceCents: subscriptions.priceCents,
          billingCycle: subscriptions.billingCycle,
          checkoutUrl: subscriptions.checkoutUrl,
          plano: plans.name,
        })
        .from(subscriptions)
        .leftJoin(plans, eq(plans.id, subscriptions.planId))
        .where(eq(subscriptions.organizationId, organizationId))
        .limit(1);
      const contato = await ownerContact(tx, organizationId);
      return { oficina, assinatura, contato };
    });
    const { oficina, assinatura, contato } = contexto;
    if (!oficina || !assinatura || !contato) return null;

    const devido = etapaDoAtraso(assinatura, agora);
    if (!devido) return null;
    const hora = horaLocal(agora, oficina.timezone);
    if (hora < 8 || hora >= 20) return null;

    const kind = tipoGravado(devido.etapa, devido.desde);
    const gravou = await withTenant(this.deps.db, { organizationId }, async (tx) => {
      const linhas = await tx
        .insert(lifecycleEmails)
        .values({ organizationId, kind, sentTo: contato.email })
        .onConflictDoNothing()
        .returning({ id: lifecycleEmails.id });
      return linhas.length > 0;
    });
    if (!gravou) return null;

    const texto = this.escrever(devido, {
      oficina: oficina.name,
      dono: primeiroNome(contato.name),
      timezone: oficina.timezone,
      plano: assinatura.plano,
      valor: assinatura.priceCents,
      ciclo: assinatura.billingCycle,
      paginaDaFatura: assinatura.checkoutUrl,
    });
    try {
      await this.deps.email.send({ to: contato.email, ...texto });
    } catch (erro) {
      this.deps.log.error({ err: erro, organizationId, kind }, 'aviso de atraso falhou; tenta de novo na próxima volta');
      await withTenant(this.deps.db, { organizationId }, (tx) =>
        tx.delete(lifecycleEmails).where(and(eq(lifecycleEmails.organizationId, organizationId), eq(lifecycleEmails.kind, kind))),
      );
      return null;
    }
    return devido.etapa;
  }

  // ------------------------------------------------------------- os textos

  private escrever(
    devido: { etapa: EtapaDoAtraso; desde: Date; motivo: 'MENSALIDADE' | 'TESTE' },
    d: {
      oficina: string;
      dono: string;
      timezone: string;
      plano: string | null;
      valor: number | null;
      ciclo: string;
      paginaDaFatura: string | null;
    },
  ): { subject: string; text: string } {
    const app = this.deps.env.APP_URL;
    const travaEm = dataLocal(new Date(devido.desde.getTime() + CARENCIA), d.timezone);
    // "mensalidade do plano Nitro (R$ 499,00)"
    const conta =
      `${d.ciclo === 'YEARLY' ? 'anuidade' : 'mensalidade'}${d.plano ? ` do plano ${d.plano}` : ''}` +
      (d.valor !== null ? ` (${formatBRL(d.valor)})` : '');
    const comoPagar =
      devido.motivo === 'TESTE'
        ? `Assinar: ${app}/configuracoes/plano`
        : (d.paginaDaFatura ? `Pagar agora (Pix, boleto ou cartão): ${d.paginaDaFatura}\n` : '') +
          `Ou pelo sistema, em ${app}/configuracoes/plano`;

    switch (devido.etapa) {
      case 'PAGAMENTO_PENDENTE':
        return {
          subject: 'Não identificamos o pagamento do OficinaOS',
          text:
            `Olá, ${d.dono}!\n\n` +
            `Ainda não identificamos o pagamento da ${conta} da ${d.oficina}. ` +
            'Pode ser só o banco compensando: se você já pagou, desconsidere este e-mail.\n\n' +
            `Nada muda por enquanto. O sistema segue funcionando normalmente até ${travaEm}.\n\n` +
            comoPagar +
            ASSINATURA_DO_EMAIL,
        };
      case 'TRAVA_EM_2_DIAS':
        return {
          subject: `O OficinaOS fica só para consulta em ${travaEm}`,
          text:
            `Olá, ${d.dono}!\n\n` +
            (devido.motivo === 'TESTE'
              ? `O teste grátis da ${d.oficina} terminou e a assinatura ainda não foi feita. `
              : `A ${conta} da ${d.oficina} continua em aberto. `) +
            `Em ${travaEm}, o sistema passa a ser só para consulta: dá para ver tudo, mas não para abrir ` +
            'ordens de serviço, orçamentos ou agendamentos.\n\n' +
            'Para não parar o atendimento:\n' +
            comoPagar +
            '\n\nNada é apagado em nenhum momento.' +
            ASSINATURA_DO_EMAIL,
        };
      case 'SISTEMA_TRAVADO':
        return {
          subject: 'Seu OficinaOS está só para consulta (seus dados estão seguros)',
          text:
            `Olá, ${d.dono}!\n\n` +
            `O OficinaOS da ${d.oficina} está só para consulta: ` +
            (devido.motivo === 'TESTE' ? 'o teste terminou sem assinatura.' : `a ${conta} não foi paga.`) +
            ' Clientes, carros, ordens de serviço e estoque continuam todos lá, e você ainda entra e consulta tudo.\n\n' +
            (devido.motivo === 'TESTE'
              ? 'Para voltar a trabalhar, é só escolher o plano:\n'
              : 'Para liberar, é só pagar: o sistema volta sozinho assim que o pagamento é confirmado ' +
                '(no Pix e no cartão, em minutos).\n') +
            comoPagar +
            ASSINATURA_DO_EMAIL,
        };
    }
  }
}
