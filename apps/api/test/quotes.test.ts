import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/db/tenant';
import {
  addMember,
  bearer,
  createCustomer,
  createPart,
  createTestApp,
  createVehicle,
  createWorkOrder,
  nextIp,
  signup,
  testDb,
  type TestApp,
  type TestSession,
} from './helpers';

/** O que o teste usa do orçamento. Tipado de verdade: `any` some do typecheck. */
interface TestQuote {
  id: string;
  number: number;
  version: number;
  status: string;
  kind: string;
  publicUrl: string;
  totalCents: number;
  items: { id: string; isOptional: boolean; totalCents: number }[];
}

/**
 * O fluxo prioritário do produto (ARCHITECTURE §8.1): orçamento → link →
 * cliente aprova → OS aprovada, com estoque reservado e prova guardada.
 */
describe('orçamento e aprovação', () => {
  let t: TestApp;
  let owner: TestSession;
  let serviceId: string;

  beforeAll(async () => {
    t = await createTestApp();
    owner = await signup(t.app);
    const service = await t.app.inject({
      method: 'POST',
      url: '/api/v1/services',
      headers: bearer(owner.accessToken),
      payload: { name: 'Troca de pastilhas', priceCents: 18000 },
    });
    serviceId = service.json().id;
  });
  afterAll(async () => {
    await t.app.close();
  });

  const post = (url: string, payload: Record<string, unknown> = {}, s: TestSession = owner) =>
    t.app.inject({ method: 'POST', url, headers: bearer(s.accessToken), payload });
  const get = (url: string, s: TestSession = owner) => t.app.inject({ method: 'GET', url, headers: bearer(s.accessToken) });

  /** O DTO não expõe o token cru: ele vem dentro do publicUrl. */
  const tokenOf = (quote: { publicUrl: string }) => quote.publicUrl.split('/').pop() as string;

  /** Rotas do cliente: sem token de sessão, com IP próprio (os limites são por IP). */
  const publicGet = (token: string) =>
    t.app.inject({ method: 'GET', url: `/api/v1/public/quotes/${token}`, remoteAddress: nextIp() });
  const publicPost = (token: string, action: string, payload: Record<string, unknown>) =>
    t.app.inject({
      method: 'POST',
      url: `/api/v1/public/quotes/${token}/${action}`,
      remoteAddress: nextIp(),
      payload,
    });

  /**
   * Placa Mercosul válida e única: 3 letras, dígito, letra, 2 dígitos.
   * Sorteio não serve — a placa é única por oficina e este teste cria vários
   * carros na mesma. O contador dá validade E unicidade.
   */
  let placas = 0;
  function nextPlate(): string {
    placas += 1;
    const letras = ['QTA', 'QTB', 'QTC', 'QTD', 'QTE', 'QTF', 'QTG', 'QTH', 'QTI', 'QTJ'];
    const letra = String.fromCharCode(65 + (placas % 26));
    return `${letras[placas % letras.length]}${placas % 10}${letra}${String(placas % 100).padStart(2, '0')}`;
  }

  /** OS com um serviço e (opcionalmente) uma peça, já orçada. */
  async function sendQuote(options: { partId?: string; quantity?: number; optionalPart?: boolean } = {}, s: TestSession = owner) {
    const customer = await createCustomer(t.app, s, { name: 'João Pereira', whatsapp: '(11) 91234-5678' });
    const vehicle = await createVehicle(t.app, s, customer.id, { plate: nextPlate() });
    const items: Record<string, unknown>[] = [{ type: 'SERVICE', serviceId }];
    if (options.partId) {
      items.push({ type: 'PART', partId: options.partId, quantity: options.quantity ?? 1, isOptional: options.optionalPart ?? false });
    }
    const order = await createWorkOrder(t.app, s, { customerId: customer.id, vehicleId: vehicle.id, items });
    const quote = await post(`/api/v1/work-orders/${order.id}/quotes`, {}, s);
    expect(quote.statusCode, quote.body).toBe(201);
    return { order, quote: quote.json() as TestQuote };
  }

  describe('envio', () => {
    it('congela os itens, gera o link e deixa a OS aguardando aprovação', async () => {
      const { order, quote } = await sendQuote();
      expect(quote).toMatchObject({ status: 'SENT', kind: 'INITIAL', version: 1, totalCents: 18000 });
      expect(quote.publicUrl).toMatch(/\/orcamento\/[A-Za-z0-9_-]{20,}$/);
      expect(quote.items).toHaveLength(1);

      const os = (await get(`/api/v1/work-orders/${order.number}`)).json();
      expect(os.status).toBe('AWAITING_APPROVAL');
      expect(os.items[0].approvalStatus).toBe('PENDING');
    });

    it('a OS informa o orçamento atual: null, aguardando, e depois decidido', async () => {
      const customer = await createCustomer(t.app, owner, { name: 'Dona do Palio' });
      const vehicle = await createVehicle(t.app, owner, customer.id, { plate: nextPlate() });
      const order = await createWorkOrder(t.app, owner, {
        customerId: customer.id,
        vehicleId: vehicle.id,
        items: [{ type: 'SERVICE', serviceId }],
      });
      // sem orçamento: a tela mostra o convite para enviar
      expect((await get(`/api/v1/work-orders/${order.number}`)).json().currentQuote).toBeNull();

      const quote = (await post(`/api/v1/work-orders/${order.id}/quotes`, {})).json() as TestQuote;
      const aguardando = (await get(`/api/v1/work-orders/${order.number}`)).json().currentQuote;
      expect(aguardando).toMatchObject({ id: quote.id, number: quote.number, status: 'SENT', awaitingAnswer: true });

      await post(`/api/v1/quotes/${quote.id}/manual-decision`, { decision: 'APPROVED', channel: 'PHONE' });
      const decidido = (await get(`/api/v1/work-orders/${order.number}`)).json().currentQuote;
      expect(decidido).toMatchObject({ status: 'APPROVED', awaitingAnswer: false });
    });

    it('OS sem item novo não vira orçamento', async () => {
      const customer = await createCustomer(t.app, owner);
      const vehicle = await createVehicle(t.app, owner, customer.id);
      const order = await createWorkOrder(t.app, owner, { customerId: customer.id, vehicleId: vehicle.id });
      const res = await post(`/api/v1/work-orders/${order.id}/quotes`, {});
      expect(res.statusCode).toBe(400);
      expect(res.json().errors[0].path).toBe('body.itemIds');
    });

    it('mecânico não envia orçamento', async () => {
      const mechanic = await addMember(t.app, owner, 'MECHANIC');
      const { order } = await sendQuote();
      expect((await post(`/api/v1/work-orders/${order.id}/quotes`, {}, mechanic)).statusCode).toBe(403);
    });
  });

  describe('a página do cliente', () => {
    it('abre sem login, registra a visualização e esconde o que é da oficina', async () => {
      const { quote } = await sendQuote();
      const res = await publicGet(tokenOf(quote));
      expect(res.statusCode, res.body).toBe(200);
      const publico = res.json();

      expect(publico).toMatchObject({ number: quote.number, status: 'SENT', totalCents: 18000 });
      expect(publico.customerFirstName).toBe('João');
      expect(publico.contentHash).toEqual(expect.any(String));
      // o que o cliente não precisa ver para decidir, não sai da API
      expect(JSON.stringify(publico)).not.toContain('unitCostCents');
      expect(JSON.stringify(publico)).not.toContain('document');

      const naOficina = (await get(`/api/v1/quotes/${quote.id}`)).json();
      expect(naOficina.viewCount).toBe(1);
      expect(naOficina.firstViewedAt).not.toBeNull();
    });

    it('token inventado não existe', async () => {
      expect((await publicGet('token-que-nao-existe-mas-tem-tamanho')).statusCode).toBe(404);
    });
  });

  describe('aprovação pelo link', () => {
    it('aprova tudo: grava a prova, aprova a OS e reserva a peça', async () => {
      const part = await createPart(t.app, owner, { name: 'Pastilha', salePriceCents: 25000, initialQuantity: 4, initialUnitCostCents: 10000 });
      const { order, quote } = await sendQuote({ partId: part.id, quantity: 2 });
      const token = tokenOf(quote);
      const publico = (await publicGet(token)).json();

      const aprovado = await publicPost(token, 'approve', {
        approvedItemIds: publico.items.map((item: { id: string }) => item.id),
        signerName: 'João Pereira',
        accepted: true,
        contentHash: publico.contentHash,
      });
      expect(aprovado.statusCode, aprovado.body).toBe(200);
      expect(aprovado.json().decision).toMatchObject({ decision: 'APPROVED', signerName: 'João Pereira' });

      const os = (await get(`/api/v1/work-orders/${order.number}`)).json();
      expect(os.status).toBe('APPROVED');
      expect(os.items.every((item: { approvalStatus: string }) => item.approvalStatus === 'APPROVED')).toBe(true);
      const peca = os.items.find((item: { type: string }) => item.type === 'PART');
      expect(peca).toMatchObject({ stockStatus: 'RESERVED', reservedQuantity: 2 });

      // a reserva sai do disponível da peça, sem mexer no que está em estoque
      const ficha = (await get(`/api/v1/parts/${part.id}`)).json();
      expect(ficha).toMatchObject({ quantityOnHand: 4, quantityReserved: 2, quantityAvailable: 2 });
    });

    it('dois toques em "aprovar" registram UMA decisão', async () => {
      const { quote } = await sendQuote();
      const token = tokenOf(quote);
      const publico = (await publicGet(token)).json();
      const corpo = {
        approvedItemIds: publico.items.map((item: { id: string }) => item.id),
        signerName: 'João',
        accepted: true,
        contentHash: publico.contentHash,
      };

      const primeira = await publicPost(token, 'approve', corpo);
      const segunda = await publicPost(token, 'approve', corpo);
      expect(primeira.statusCode).toBe(200);
      expect(segunda.statusCode, segunda.body).toBe(200);
      expect(segunda.json().decision.decidedAt).toBe(primeira.json().decision.decidedAt);
    });

    it('aprovação parcial: o recusado não entra no total nem reserva peça', async () => {
      const part = await createPart(t.app, owner, { name: 'Disco', salePriceCents: 30000, initialQuantity: 5, initialUnitCostCents: 12000 });
      const { order, quote } = await sendQuote({ partId: part.id, quantity: 1, optionalPart: true });
      const token = tokenOf(quote);
      const publico = (await publicGet(token)).json();
      const necessario = publico.items.find((item: { isOptional: boolean }) => !item.isOptional);

      const res = await publicPost(token, 'approve', {
        approvedItemIds: [necessario.id],
        signerName: 'João',
        accepted: true,
        contentHash: publico.contentHash,
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().decision).toMatchObject({ decision: 'PARTIALLY_APPROVED', approvedTotalCents: 18000 });

      const os = (await get(`/api/v1/work-orders/${order.number}`)).json();
      expect(os.totals.approvedTotalCents).toBe(18000);
      const peca = os.items.find((item: { type: string }) => item.type === 'PART');
      expect(peca.approvalStatus).toBe('REJECTED');
      expect((await get(`/api/v1/parts/${part.id}`)).json().quantityReserved).toBe(0);
    });

    it('aprovar sem escolher nenhum item é recusado', async () => {
      const { quote } = await sendQuote();
      const token = tokenOf(quote);
      const publico = (await publicGet(token)).json();
      const res = await publicPost(token, 'approve', {
        approvedItemIds: [],
        signerName: 'João',
        accepted: true,
        contentHash: publico.contentHash,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().errors[0].path).toBe('body.approvedItemIds');
    });

    it('item necessário não pode ser desmarcado, mesmo marcando o recomendado', async () => {
      const part = await createPart(t.app, owner, { name: 'Palheta', salePriceCents: 9000, initialQuantity: 3, initialUnitCostCents: 4000 });
      const { quote } = await sendQuote({ partId: part.id, quantity: 1, optionalPart: true });
      const token = tokenOf(quote);
      const publico = (await publicGet(token)).json();
      const recomendado = publico.items.find((item: { isOptional: boolean }) => item.isOptional);

      const res = await publicPost(token, 'approve', {
        approvedItemIds: [recomendado.id],
        signerName: 'João',
        accepted: true,
        contentHash: publico.contentHash,
      });
      // a mensagem importa: lista vazia cai em OUTRA validação e passaria aqui à toa
      expect(res.statusCode, res.body).toBe(400);
      expect(res.body).toContain('necessários');
    });

    it('o link velho não aprova depois que a oficina mandou outra versão', async () => {
      const { order, quote } = await sendQuote();
      const token = tokenOf(quote);
      const publico = (await publicGet(token)).json();

      await post(`/api/v1/work-orders/${order.id}/items`, { type: 'SERVICE', description: 'Alinhamento', unitPriceCents: 8000 });
      expect((await post(`/api/v1/work-orders/${order.id}/quotes`, {})).statusCode).toBe(201);

      // o cliente ficou com a aba aberta e aprovou a versão que já foi substituída
      const res = await publicPost(token, 'approve', {
        approvedItemIds: publico.items.map((item: { id: string }) => item.id),
        signerName: 'João',
        accepted: true,
        contentHash: publico.contentHash,
      });
      expect(res.statusCode, res.body).toBe(409);
      expect(res.body).toContain('respondido ou cancelado');
    });

    it('o link do WhatsApp abre a conversa com o cliente, não com a oficina', async () => {
      const { quote } = await sendQuote();
      const res = await post(`/api/v1/quotes/${quote.id}/share`, { channel: 'WHATSAPP_LINK' });
      expect(res.statusCode, res.body).toBe(200);

      const { whatsappUrl, message } = res.json() as { whatsappUrl: string; message: string };
      expect(message).toContain('João');
      // o cliente do cenário é (11) 91234-5678, gravado como +5511912345678.
      // O wa.me quer só dígitos: nada de "+" nem de "55" repetido.
      expect(whatsappUrl).toContain('https://wa.me/5511912345678?text=');
      expect(whatsappUrl).not.toContain('+');
      expect(whatsappUrl).not.toContain('wa.me/5555');
    });

    it('orçamento vencido não aceita mais resposta', async () => {
      const { quote } = await sendQuote();
      const token = tokenOf(quote);
      const publico = (await publicGet(token)).json();

      // a validade mínima é 1 dia, então para testar o vencimento a data é
      // empurrada — pelo mesmo caminho da aplicação, com RLS ligado e o
      // contexto da oficina, e não por fora do isolamento
      await withTenant(testDb().db, { organizationId: owner.me.organization.id }, (tx) =>
        tx.execute(sql`update quotes set valid_until = now() - interval '1 day' where id = ${quote.id}`),
      );

      const res = await publicPost(token, 'approve', {
        approvedItemIds: publico.items.map((item: { id: string }) => item.id),
        signerName: 'João',
        accepted: true,
        contentHash: publico.contentHash,
      });
      expect(res.statusCode, res.body).toBe(409);
      expect(res.body).toContain('venceu');
    });

    it('aprovar sem marcar o aceite é recusado', async () => {
      const { quote } = await sendQuote();
      const token = tokenOf(quote);
      const publico = (await publicGet(token)).json();
      const res = await publicPost(token, 'approve', {
        approvedItemIds: publico.items.map((item: { id: string }) => item.id),
        signerName: 'João',
        accepted: false,
        contentHash: publico.contentHash,
      });
      expect(res.statusCode).toBe(400);
    });

    it('versão velha (hash diferente) dá 409: ninguém aprova um valor e recebe outro', async () => {
      const { quote } = await sendQuote();
      const token = tokenOf(quote);
      const publico = (await publicGet(token)).json();
      const res = await publicPost(token, 'approve', {
        approvedItemIds: publico.items.map((item: { id: string }) => item.id),
        signerName: 'João',
        accepted: true,
        contentHash: 'hash-de-uma-versao-antiga-qualquer',
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('CONFLICT');
    });
  });

  describe('recusa e pergunta', () => {
    it('recusar volta a OS para "aguardando orçamento" e não reserva nada', async () => {
      const part = await createPart(t.app, owner, { name: 'Correia', salePriceCents: 9000, initialQuantity: 3, initialUnitCostCents: 4000 });
      const { order, quote } = await sendQuote({ partId: part.id });
      const token = tokenOf(quote);
      const publico = (await publicGet(token)).json();

      const res = await publicPost(token, 'reject', { reason: 'Vou fazer mês que vem', contentHash: publico.contentHash });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().decision.decision).toBe('REJECTED');

      const os = (await get(`/api/v1/work-orders/${order.number}`)).json();
      expect(os.status).toBe('AWAITING_QUOTE');
      expect((await get(`/api/v1/parts/${part.id}`)).json().quantityReserved).toBe(0);
    });

    it('pergunta do cliente vira evento na timeline', async () => {
      const { order, quote } = await sendQuote();
      const token = tokenOf(quote);
      const res = await publicPost(token, 'questions', { message: 'Dá para fazer só o freio agora?' });
      expect(res.statusCode).toBe(204);

      const timeline = (await get(`/api/v1/work-orders/${order.id}/timeline`)).json().data as { type: string; data: Record<string, unknown> }[];
      expect(timeline[0]).toMatchObject({ type: 'CUSTOMER_QUESTION', data: { message: 'Dá para fazer só o freio agora?' } });
    });
  });

  describe('versão nova e decisão registrada pela equipe', () => {
    it('orçamento novo substitui o anterior, e o link antigo leva ao novo', async () => {
      const { order, quote } = await sendQuote();
      const tokenAntigo = tokenOf(quote);

      await post(`/api/v1/work-orders/${order.id}/items`, { type: 'SERVICE', description: 'Alinhamento', unitPriceCents: 8000 });
      const segundo = await post(`/api/v1/work-orders/${order.id}/quotes`, {});
      expect(segundo.statusCode, segundo.body).toBe(201);
      expect(segundo.json()).toMatchObject({ version: 2, kind: 'SUPPLEMENTARY' });

      const antigo = await publicGet(tokenAntigo);
      expect(antigo.statusCode).toBe(200);
      expect(antigo.json().redirectToken).toBe(segundo.json().publicUrl.split('/').pop());
    });

    it('cancelar a OS tira o orçamento de "aguardando resposta" e mata o link', async () => {
      const { order, quote } = await sendQuote();
      const token = tokenOf(quote);
      expect((await publicGet(token)).json().status).toBe('SENT');

      const cancelou = await post(`/api/v1/work-orders/${order.id}/cancel`, { reason: 'Cliente desistiu' });
      expect(cancelou.statusCode, cancelou.body).toBe(200);

      const depois = await get(`/api/v1/quotes/${quote.id}`);
      expect(depois.statusCode, depois.body).toBe(200);
      expect(depois.json().status, 'não fica mais eternamente aguardando').toBe('REVOKED');

      // e o link continua abrindo, mas dizendo que foi cancelado — em vez de
      // convidar o cliente a aprovar um serviço que não vai acontecer
      const publica = await publicGet(token);
      expect(publica.statusCode).toBe(200);
      expect(publica.json().status).toBe('REVOKED');
      const publica2 = publica.json();
      const tentativa = await publicPost(token, 'approve', {
        approvedItemIds: publica2.items.map((item: { id: string }) => item.id),
        signerName: 'João Pereira',
        accepted: true,
        contentHash: publica2.contentHash,
      });
      expect(tentativa.statusCode, 'o link não aceita mais aprovação').toBe(409);
    });

    it('o atendente registra a aprovação que o cliente deu por telefone', async () => {
      const attendant = await addMember(t.app, owner, 'ATTENDANT');
      const { order, quote } = await sendQuote();
      const res = await post(`/api/v1/quotes/${quote.id}/manual-decision`, { decision: 'APPROVED', channel: 'PHONE', signerName: 'João Pereira' }, attendant);
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().decision).toMatchObject({ decision: 'APPROVED', channel: 'PHONE', recordedByName: 'Pessoa da Equipe' });
      expect((await get(`/api/v1/work-orders/${order.number}`)).json().status).toBe('APPROVED');
    });

    it('mecânico não registra aprovação', async () => {
      const mechanic = await addMember(t.app, owner, 'MECHANIC');
      const { quote } = await sendQuote();
      expect((await post(`/api/v1/quotes/${quote.id}/manual-decision`, { decision: 'APPROVED', channel: 'PHONE' }, mechanic)).statusCode).toBe(403);
    });
  });

  describe('isolamento e mensagem pronta', () => {
    it('o link de uma oficina não é visível na outra', async () => {
      const { quote } = await sendQuote();
      const outra = await signup(t.app);
      expect((await get(`/api/v1/quotes/${quote.id}`, outra)).statusCode).toBe(404);
      expect((await get('/api/v1/quotes?status=all', outra)).json().data).toEqual([]);
    });

    it('compartilhar devolve a mensagem pronta com o link', async () => {
      const { quote } = await sendQuote();
      const res = await post(`/api/v1/quotes/${quote.id}/share`, { channel: 'WHATSAPP_LINK' });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().message).toContain('Olá, João!');
      expect(res.json().message).toContain(quote.publicUrl);
      expect(res.json().whatsappUrl).toContain('wa.me/55');
    });
  });
});
