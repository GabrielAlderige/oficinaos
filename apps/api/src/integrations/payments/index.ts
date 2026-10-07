import type { Env } from '../../config/env';
import { AsaasPaymentGateway } from './asaas';
import { SimuladorPaymentGateway, type PaymentGateway } from './gateway';

export * from './gateway';
export { AsaasPaymentGateway, statusDoAsaas } from './asaas';

/**
 * Qual gateway responde (E19). O padrão é o **simulador**: sem chave
 * configurada, ninguém deveria conseguir cobrar de cliente nenhum por acidente.
 */
export function createPaymentGateway(env: Env): PaymentGateway {
  if (env.PAYMENT_GATEWAY === 'asaas') {
    if (!env.ASAAS_API_KEY || !env.ASAAS_WEBHOOK_TOKEN) {
      throw new Error('PAYMENT_GATEWAY=asaas exige ASAAS_API_KEY e ASAAS_WEBHOOK_TOKEN no ambiente');
    }
    return new AsaasPaymentGateway({
      apiKey: env.ASAAS_API_KEY,
      baseUrl: env.ASAAS_BASE_URL,
      webhookToken: env.ASAAS_WEBHOOK_TOKEN,
      // sandbox e produção se distinguem pela URL: é o que o Asaas usa
      environment: env.ASAAS_BASE_URL.includes('sandbox') ? 'SANDBOX' : 'PRODUCTION',
    });
  }
  return new SimuladorPaymentGateway();
}

/**
 * Quem cria a cobrança da oficina para o cliente dela. `null` é desligado: a
 * tela esconde o cartão e a API recusa cobrança nova. O aviso (webhook) segue
 * lido pelo gateway da plataforma, que é quem tem o token.
 */
export function createChargesGateway(env: Env, plataforma: PaymentGateway): PaymentGateway | null {
  const modo = env.CHARGES_GATEWAY ?? (env.NODE_ENV === 'production' ? 'desligado' : 'simulador');
  if (modo === 'desligado') return null;
  if (modo === 'asaas') {
    if (plataforma.driver !== 'asaas') throw new Error('CHARGES_GATEWAY=asaas exige PAYMENT_GATEWAY=asaas');
    return plataforma;
  }
  return plataforma.driver === 'simulador' ? plataforma : new SimuladorPaymentGateway();
}
