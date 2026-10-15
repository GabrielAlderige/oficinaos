import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SimuladorPaymentGateway, type PedidoDeAssinatura } from '../src/integrations/payments/gateway';
import { bearer, createTestApp, signup, type TestApp } from './helpers';

/** O simulador, guardando o que a API pediu ao gateway. */
class GatewayQueAnota extends SimuladorPaymentGateway {
  pedidos: PedidoDeAssinatura[] = [];
  override async criarAssinatura(pedido: PedidoDeAssinatura) {
    this.pedidos.push(pedido);
    return super.criarAssinatura(pedido);
  }
}

/**
 * Os avisos da mensalidade (vence em 10 dias, vence hoje, venceu) quem manda é
 * o Asaas, para o e-mail do cliente cadastrado lá. Em produção a oficina
 * assinou sem e-mail da oficina preenchido, e o cliente nasceu no Asaas sem
 * e-mail nenhum: nenhum aviso chegaria (15/10/2026).
 */
describe('e-mail que vai para o gateway na assinatura', () => {
  let t: TestApp;
  const gateway = new GatewayQueAnota();

  beforeAll(async () => {
    t = await createTestApp({}, { gateway });
  });
  afterAll(async () => {
    await t.app.close();
  });

  const preparar = async (patch: Record<string, unknown>) => {
    const dono = await signup(t.app);
    const res = await t.app.inject({
      method: 'PATCH',
      url: '/api/v1/organization',
      headers: bearer(dono.accessToken),
      payload: { document: '11.222.333/0001-81', ...patch },
    });
    expect(res.statusCode, res.body).toBe(200);
    return dono;
  };
  const assinar = async (accessToken: string) => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/v1/billing/subscribe',
      headers: bearer(accessToken),
      payload: { clientRequestId: randomUUID(), plan: 'TURBO', cycle: 'MONTHLY' },
    });
    expect(res.statusCode, res.body).toBe(200);
    return gateway.pedidos.at(-1)!;
  };

  it('oficina sem e-mail preenchido: vai o e-mail do dono', async () => {
    const dono = await preparar({});
    const pedido = await assinar(dono.accessToken);
    expect(pedido.cliente.email, 'sem e-mail o Asaas não avisa do vencimento').toBe(dono.email);
  });

  it('oficina com e-mail próprio: vai o da oficina', async () => {
    const proprio = `financeiro-${randomUUID().slice(0, 8)}@exemplo.invalido`;
    const dono = await preparar({ email: proprio });
    const pedido = await assinar(dono.accessToken);
    expect(pedido.cliente.email).toBe(proprio);
  });
});
