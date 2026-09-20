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
