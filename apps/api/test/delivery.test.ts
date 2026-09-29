import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bearer,
  createCustomer,
  createTestApp,
  createVehicle,
  createWorkOrder,
  signup,
  type TestApp,
  type TestSession,
} from './helpers';

const ARQUIVO = Buffer.from('png da assinatura', 'utf8');

interface Inspecao {
  type: string;
  odometerKm: number | null;
  signerName: string | null;
  customerAcknowledgedAt: string | null;
  signature: { id: string; url: string | null } | null;
  photos: { id: string }[];
}

/**
 * Assinatura e foto na entrega (E28).
 *
 * O que precisa ficar provado: entregar continua funcionando SEM nada (é o que
 * a maioria faz), o comprovante fica guardado quando existe, e a oficina que
 * liga o interruptor tem a entrega recusada sem assinatura — recusada de
 * verdade, com a OS ainda na oficina.
 */
describe('entrega com assinatura e foto', () => {
  let t: TestApp;
  let dono: TestSession;
  let servico: string;
  let clienteId: string;
  let sequencia = 0;

  const post = (url: string, payload: unknown = {}, s: TestSession = dono) =>
    t.app.inject({ method: 'POST', url, headers: bearer(s.accessToken), payload: payload as never });
  const get = (url: string, s: TestSession = dono) =>
    t.app.inject({ method: 'GET', url, headers: bearer(s.accessToken) });

  /** Uma OS pronta para entregar: aprovada, iniciada e finalizada. */
  async function osFinalizada() {
    // o carro já vem com km: sem isso, a regra do km que não diminui não tem
    // com o que comparar e o teste passaria por engano
    const veiculo = await createVehicle(t.app, dono, clienteId, {
      plate: `ENT${1000 + sequencia++}`,
      odometerKm: 50_000,
    });
    const os = await createWorkOrder(t.app, dono, {
      customerId: clienteId,
      vehicleId: veiculo.id,
      odometerKm: 50_000,
      items: [{ type: 'SERVICE', serviceId: servico }],
    });
    const orcamento = (await post(`/api/v1/work-orders/${os.id}/quotes`)).json() as { id: string };
    await post(`/api/v1/quotes/${orcamento.id}/manual-decision`, { decision: 'APPROVED', channel: 'PHONE' });
    await post(`/api/v1/work-orders/${os.id}/start`);
    await post(`/api/v1/work-orders/${os.id}/complete`);
    return os;
  }

  /** Sobe um arquivo de verdade e devolve o id do anexo pronto. */
  async function anexo(workOrderId: string) {
    const bilhete = (
      await post('/api/v1/uploads', {
        kind: 'PHOTO',
        mimeType: 'image/png',
        sizeBytes: ARQUIVO.byteLength,
        workOrderId,
      })
    ).json() as { attachment: { id: string }; uploadUrl: string };
    await t.app.inject({
      method: 'PUT',
      url: bilhete.uploadUrl,
      headers: { 'content-type': 'image/png' },
      payload: ARQUIVO,
    });
    await post(`/api/v1/uploads/${bilhete.attachment.id}/complete`);
    return bilhete.attachment.id;
  }

  const exigirAssinatura = (valor: boolean) =>
    t.app.inject({
      method: 'PATCH',
      url: '/api/v1/organization/settings',
      headers: bearer(dono.accessToken),
      payload: { requireDeliverySignature: valor },
    });

  beforeAll(async () => {
    t = await createTestApp();
    dono = await signup(t.app);
    servico = ((await post('/api/v1/services', { name: 'Revisão', priceCents: 30_000 })).json() as { id: string }).id;
    clienteId = (await createCustomer(t.app, dono, { name: 'João Pereira' })).id;
  });
  afterAll(async () => {
    await t.app.close();
  });

  it('entregar sem assinatura continua funcionando, e não inventa comprovante', async () => {
    const os = await osFinalizada();
    const entregue = await post(`/api/v1/work-orders/${os.id}/deliver`);
    expect(entregue.statusCode, entregue.body).toBe(200);
    expect(entregue.json().status).toBe('DELIVERED');

    const inspecoes = (await get(`/api/v1/work-orders/${os.id}/inspections`)).json() as { data: Inspecao[] };
    expect(inspecoes.data.filter((i) => i.type === 'CHECK_OUT'), 'sem prova, sem check-out vazio').toHaveLength(0);
  });

  it('a assinatura e as fotos ficam guardadas com a entrega', async () => {
    const os = await osFinalizada();
    const assinatura = await anexo(os.id);
    const foto = await anexo(os.id);

    const entregue = await post(`/api/v1/work-orders/${os.id}/deliver`, {
      signerName: 'Maria Pereira',
      signatureAttachmentId: assinatura,
      photoAttachmentIds: [foto],
      odometerKm: 50_120,
    });
    expect(entregue.statusCode, entregue.body).toBe(200);
    expect(entregue.json().odometerKm, 'o km da saída vira o km do carro').toBe(50_120);

    const inspecoes = (await get(`/api/v1/work-orders/${os.id}/inspections`)).json() as { data: Inspecao[] };
    const comprovante = inspecoes.data.find((i) => i.type === 'CHECK_OUT');
    expect(comprovante, 'a entrega virou um check-out').toBeDefined();
    expect(comprovante!.signerName).toBe('Maria Pereira');
    expect(comprovante!.customerAcknowledgedAt).not.toBeNull();
    expect(comprovante!.signature?.id).toBe(assinatura);
    expect(comprovante!.signature?.url, 'a tela precisa da URL assinada para mostrar').toBeTruthy();
    expect(comprovante!.photos.map((p) => p.id), 'a assinatura não se repete entre as fotos').toEqual([foto]);
  });

  it('com o interruptor ligado, entregar sem assinatura é recusado', async () => {
    await exigirAssinatura(true);
    const os = await osFinalizada();

    const recusada = await post(`/api/v1/work-orders/${os.id}/deliver`, { signerName: 'Maria' });
    expect(recusada.statusCode).toBe(422);
    expect(recusada.json().title).toBe('Assinatura obrigatória');

    const depois = (await get(`/api/v1/work-orders/${os.number}`)).json() as { status: string };
    expect(depois.status, 'o carro continua na oficina').toBe('COMPLETED');

    // com a assinatura, a mesma entrega passa
    const ok = await post(`/api/v1/work-orders/${os.id}/deliver`, {
      signerName: 'Maria Pereira',
      signatureAttachmentId: await anexo(os.id),
    });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().status).toBe('DELIVERED');
    await exigirAssinatura(false);
  });

  it('o km da saída não pode ser menor que o do carro', async () => {
    const os = await osFinalizada();
    const res = await post(`/api/v1/work-orders/${os.id}/deliver`, { odometerKm: 10 });
    expect(res.statusCode, 'a mesma regra do cadastro do veículo (E3)').toBe(422);
    expect(res.json().code).toBe('ODOMETER_DECREASE');

    const depois = (await get(`/api/v1/work-orders/${os.number}`)).json() as { status: string };
    expect(depois.status, 'e a OS não foi entregue pela metade').toBe('COMPLETED');
  });

  it('assinatura de outra oficina não vira comprovante', async () => {
    const outra = await signup(t.app);
    const clienteDeles = await createCustomer(t.app, outra, { name: 'Cliente de outra' });
    const carroDeles = await createVehicle(t.app, outra, clienteDeles.id, { plate: 'OUT1A23' });
    const osDeles = await createWorkOrder(t.app, outra, {
      customerId: clienteDeles.id,
      vehicleId: carroDeles.id,
      items: [],
    });
    const bilhete = (
      await post(
        '/api/v1/uploads',
        { kind: 'PHOTO', mimeType: 'image/png', sizeBytes: ARQUIVO.byteLength, workOrderId: osDeles.id },
        outra,
      )
    ).json() as { attachment: { id: string } };

    const os = await osFinalizada();
    const res = await post(`/api/v1/work-orders/${os.id}/deliver`, {
      signerName: 'Quem?',
      signatureAttachmentId: bilhete.attachment.id,
    });
    expect(res.statusCode, 'o id existe, mas não é desta oficina').toBe(400);
  });
});
