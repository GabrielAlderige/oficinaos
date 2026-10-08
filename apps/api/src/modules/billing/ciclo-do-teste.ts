import { and, asc, eq } from 'drizzle-orm';
import { formatBRL } from '@oficinaos/shared';
import type { ServiceDeps } from '../../core/auth-context';
import { lifecycleEmails, plans, subscriptions } from '../../db/schema';
import { withTenant } from '../../db/tenant';
import * as orgRepo from '../organizations/organizations.repository';
import { ownerContact } from './billing.repository';

/**
 * Os e-mails do teste grátis (14 dias): boas-vindas no cadastro, um empurrão
 * na metade, o aviso de que faltam 3 dias, o do último dia e o de que acabou.
 *
 * Regras que explicam o resto:
 * 1. **Cada um sai uma vez.** A linha em `lifecycle_emails` é gravada ANTES do
 *    envio; se o envio falhar, ela é apagada e a próxima volta tenta de novo.
 * 2. **Um por volta.** Nunca dois e-mails de uma vez: vale a etapa em que o
 *    teste está agora. Etapa perdida (o servidor parado, o teste estendido)
 *    não é mandada atrasada.
 * 3. **Quem já assinou não recebe aviso de fim de teste.**
 * 4. **Só em horário comercial** (8h às 20h no relógio da oficina), exceto as
 *    boas-vindas, que saem na hora do cadastro.
 */

export const TIPOS_DE_EMAIL = ['BOAS_VINDAS', 'METADE_DO_TESTE', 'FALTAM_3_DIAS', 'ULTIMO_DIA', 'TESTE_ACABOU'] as const;
export type TipoDeEmail = (typeof TIPOS_DE_EMAIL)[number];

const DIA = 86_400_000;

interface Plano {
  name: string;
  priceMonthlyCents: number;
  priceYearlyCents: number | null;
}

interface Dados {
  oficina: string;
  dono: string;
  email: string;
  fimDoTeste: Date | null;
  timezone: string;
  planos: Plano[];
}

/** Qual etapa do teste vale agora (sem olhar o que já foi enviado). */
export function etapaDoTeste(
  assinatura: { status: string; trialEndsAt: Date | null; providerSubscriptionId: string | null },
  agora: Date,
): TipoDeEmail | null {
  if (assinatura.providerSubscriptionId) return null;
  if (!assinatura.trialEndsAt) return null;
  if (assinatura.status !== 'TRIALING' && assinatura.status !== 'EXPIRED') return null;
  const falta = assinatura.trialEndsAt.getTime() - agora.getTime();
  if (falta <= 0) return -falta <= 3 * DIA ? 'TESTE_ACABOU' : null;
  if (falta <= DIA) return 'ULTIMO_DIA';
  if (falta <= 3 * DIA) return 'FALTAM_3_DIAS';
  if (falta <= 7 * DIA) return 'METADE_DO_TESTE';
  return null;
}

function horaLocal(agora: Date, timezone: string): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', hourCycle: 'h23' }).format(agora));
}

function dataLocal(data: Date, timezone: string): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: timezone, day: '2-digit', month: '2-digit' }).format(data);
}

const primeiroNome = (nome: string) => nome.trim().split(/\s+/)[0] || nome;

export class CicloDoTeste {
  constructor(private readonly deps: ServiceDeps) {}

  /**
   * Manda o e-mail que estiver devido para a oficina, se houver. Devolve o
   * tipo enviado (ou `null`). Chamado no cadastro e a cada volta do
   * trabalhador de fundo.
   */
  async enviarDevido(organizationId: string, agora = new Date()): Promise<TipoDeEmail | null> {
    // em produção sem e-mail de verdade ligado, espera: marcar como enviado o
    // que só foi para o log faria a oficina nunca receber
    if (this.deps.env.NODE_ENV === 'production' && this.deps.email.driver === 'console') return null;
    const contexto = await withTenant(this.deps.db, { organizationId }, async (tx) => {
      const oficina = await orgRepo.findOrganization(tx, organizationId);
      const [assinatura] = await tx
        .select({
          status: subscriptions.status,
          trialEndsAt: subscriptions.trialEndsAt,
          providerSubscriptionId: subscriptions.providerSubscriptionId,
        })
        .from(subscriptions)
        .where(eq(subscriptions.organizationId, organizationId))
        .limit(1);
      const contato = await ownerContact(tx, organizationId);
      const enviados = await tx
        .select({ kind: lifecycleEmails.kind })
        .from(lifecycleEmails)
        .where(eq(lifecycleEmails.organizationId, organizationId));
      const planos = await tx
        .select({ name: plans.name, priceMonthlyCents: plans.priceMonthlyCents, priceYearlyCents: plans.priceYearlyCents })
        .from(plans)
        .where(eq(plans.isPublic, true))
        .orderBy(asc(plans.priceMonthlyCents));
      return { oficina, assinatura, contato, enviados: new Set(enviados.map((e) => e.kind)), planos };
    });
    const { oficina, assinatura, contato, enviados, planos } = contexto;
    if (!oficina || !assinatura || !contato) return null;

    let tipo: TipoDeEmail | null = null;
    if (!enviados.has('BOAS_VINDAS')) {
      tipo = 'BOAS_VINDAS';
    } else {
      const etapa = etapaDoTeste(assinatura, agora);
      const hora = horaLocal(agora, oficina.timezone);
      if (etapa && !enviados.has(etapa) && hora >= 8 && hora < 20) tipo = etapa;
    }
    if (!tipo) return null;

    // grava antes de enviar: duas voltas ao mesmo tempo não mandam em dobro
    const gravou = await withTenant(this.deps.db, { organizationId }, async (tx) => {
      const linhas = await tx
        .insert(lifecycleEmails)
        .values({ organizationId, kind: tipo, sentTo: contato.email })
        .onConflictDoNothing()
        .returning({ id: lifecycleEmails.id });
      return linhas.length > 0;
    });
    if (!gravou) return null;

    const dados: Dados = {
      oficina: oficina.name,
      dono: primeiroNome(contato.name),
      email: contato.email,
      fimDoTeste: assinatura.trialEndsAt,
      timezone: oficina.timezone,
      planos,
    };
    try {
      await this.deps.email.send({ to: contato.email, ...this.escrever(tipo, dados) });
    } catch (erro) {
      this.deps.log.error({ err: erro, organizationId, tipo }, 'e-mail do ciclo do teste falhou; tenta de novo na próxima volta');
      await withTenant(this.deps.db, { organizationId }, (tx) =>
        tx.delete(lifecycleEmails).where(and(eq(lifecycleEmails.organizationId, organizationId), eq(lifecycleEmails.kind, tipo))),
      );
      return null;
    }
    return tipo;
  }

  // ------------------------------------------------------------- os textos

  private escrever(tipo: TipoDeEmail, d: Dados): { subject: string; text: string } {
    const app = this.deps.env.APP_URL;
    const ate = d.fimDoTeste ? dataLocal(d.fimDoTeste, d.timezone) : '';
    const assinatura =
      '\n\nQualquer dúvida, é só responder este e-mail ou chamar no WhatsApp (35) 99755-8675.\n\n' +
      'Gabriel Alderige\nOficinaOS · oficinaosbr.cloud';
    const tabela = d.planos
      .map((p) => {
        const anual = p.priceYearlyCents ? ` (ou ${formatBRL(p.priceYearlyCents)} por ano)` : '';
        return `  • ${p.name}: ${formatBRL(p.priceMonthlyCents)} por mês${anual}`;
      })
      .join('\n');

    switch (tipo) {
      case 'BOAS_VINDAS':
        return {
          subject: `Bem-vindo ao OficinaOS, ${d.dono}!`,
          text:
            `Olá, ${d.dono}!\n\n` +
            `A ${d.oficina} já está no OficinaOS. Você tem 14 dias grátis no plano Nitro, o mais completo, ` +
            `até ${ate}. Sem cartão e sem compromisso: no fim, você escolhe se continua.\n\n` +
            'Para tirar o melhor do teste, comece por aqui:\n\n' +
            '  1. Cadastre os serviços que você mais faz e o valor da sua hora técnica.\n' +
            '  2. Abra a primeira ordem de serviço com um carro que está no pátio hoje.\n' +
            '  3. Mande o orçamento pelo link do WhatsApp e veja o cliente aprovar pelo celular.\n' +
            '  4. Instale o sistema no celular dos mecânicos (no Android, o Chrome oferece "Instalar aplicativo").\n\n' +
            'Na aba Tutoriais tem 30 aulas de 1 minuto, uma para cada tela.\n\n' +
            `Entrar: ${app}\n\n` +
            'Se quiser, eu cadastro tudo junto com você em uma conversa rápida. É só me chamar.' +
            assinatura,
        };
      case 'METADE_DO_TESTE':
        return {
          subject: 'Como está indo o teste do OficinaOS?',
          text:
            `Olá, ${d.dono}!\n\n` +
            `Você está na metade do teste grátis do OficinaOS. Ele vai até ${ate}.\n\n` +
            'Três coisas que fazem diferença e muita oficina ainda não testou:\n\n' +
            '  • Mandar o orçamento por link: o cliente aprova item por item pelo celular, e a OS muda sozinha.\n' +
            '  • Fazer o check-in com fotos: o estado do carro na chegada fica guardado, com data.\n' +
            '  • Olhar o painel do mês: quanto foi faturado e quanto entrou de verdade no caixa.\n\n' +
            'Se algo travou ou não ficou claro, me responda este e-mail que eu te ajudo.\n\n' +
            `Entrar: ${app}` +
            assinatura,
        };
      case 'FALTAM_3_DIAS':
        return {
          subject: `Faltam 3 dias do seu teste no OficinaOS`,
          text:
            `Olá, ${d.dono}!\n\n` +
            `O teste grátis da ${d.oficina} termina em ${ate}. Para seguir sem parar, escolha um plano:\n\n` +
            `${tabela}\n\n` +
            'Não tem fidelidade: você cancela quando quiser. No anual, você paga 10 meses e usa 12. ' +
            'O pagamento é por Pix, boleto ou cartão.\n\n' +
            `Escolher o plano: ${app}/configuracoes/plano\n\n` +
            'Tudo o que você cadastrou no teste continua lá: clientes, carros, ordens de serviço e estoque.' +
            assinatura,
        };
      case 'ULTIMO_DIA':
        return {
          subject: 'Último dia do seu teste no OficinaOS',
          text:
            `Olá, ${d.dono}!\n\n` +
            `Hoje é o último dia do teste grátis da ${d.oficina}.\n\n` +
            'Para continuar usando sem interrupção, assine um plano em:\n' +
            `${app}/configuracoes/plano\n\n` +
            `${tabela}\n\n` +
            'Ficou com alguma dúvida antes de decidir? Me chame hoje que eu respondo na hora.' +
            assinatura,
        };
      case 'TESTE_ACABOU':
        return {
          subject: 'Seu teste do OficinaOS terminou (seus dados continuam lá)',
          text:
            `Olá, ${d.dono}!\n\n` +
            `O teste grátis da ${d.oficina} terminou. Nada foi apagado: você ainda entra, vê e consulta tudo o ` +
            'que cadastrou. Para voltar a lançar ordens de serviço e orçamentos, é só assinar um plano:\n\n' +
            `${tabela}\n\n` +
            `Assinar: ${app}/configuracoes/plano\n\n` +
            'Se o OficinaOS não fez sentido para a sua oficina, eu gostaria muito de saber o motivo. ' +
            'É só responder este e-mail com uma linha.' +
            assinatura,
        };
    }
  }
}
