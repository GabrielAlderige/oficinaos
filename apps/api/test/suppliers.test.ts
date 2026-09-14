import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/db/tenant';
import {
  addMember,
  bearer,
  createPart,
  createTestApp,
  signup,
  testDb,
  type TestApp,
  type TestSession,
} from './helpers';

interface TestSupplier {
  id: string;
  name: string;
  document: string | null;
  whatsapp: string | null;
  categories: string[];
  leadTimeDays: number | null;
  rating: number | null;
  preferredPartCount: number;
}

/** CNPJ numérico válido e o alfanumérico que a Receita passa a emitir. */
const CNPJ_VALIDO = '11.222.333/0001-81';
const CNPJ_ALFANUMERICO = '12.ABC.345/01DE-35';

/**
 * Fornecedores (E10). O que precisa ficar provado: o cadastro aceita o mínimo
 * (só o nome), o CNPJ não se repete na oficina, a busca acha do jeito que a
 * pessoa digita, só quem pode vê e mexe, e tirar da lista não quebra a peça
 * que o tinha como preferido.
 */
describe('fornecedores', () => {
  let t: TestApp;
  let owner: TestSession;
  let atendente: TestSession;
  let mecanico: TestSession;

  beforeAll(async () => {
    t = await createTestApp();
    owner = await signup(t.app);
    atendente = await addMember(t.app, owner, 'ATTENDANT', 'Ana Atendente');
    mecanico = await addMember(t.app, owner, 'MECHANIC', 'Zé Mecânico');
  });
  afterAll(async () => {
    await t.app.close();
  });

  const post = (url: string, payload: Record<string, unknown>, s: TestSession = owner) =>
    t.app.inject({ method: 'POST', url, headers: bearer(s.accessToken), payload });
  const patch = (url: string, payload: Record<string, unknown>, s: TestSession = owner) =>
    t.app.inject({ method: 'PATCH', url, headers: bearer(s.accessToken), payload });
  const get = (url: string, s: TestSession = owner) =>
    t.app.inject({ method: 'GET', url, headers: bearer(s.accessToken) });
  const del = (url: string, s: TestSession = owner) =>
    t.app.inject({ method: 'DELETE', url, headers: bearer(s.accessToken) });

  async function fornecedor(payload: Record<string, unknown>): Promise<TestSupplier> {
    const res = await post('/api/v1/suppliers', payload);
    expect(res.statusCode, res.body).toBe(201);
    return res.json() as TestSupplier;
  }

  const buscar = async (query: string, s: TestSession = owner) =>
    ((await get(`/api/v1/suppliers?${query}`, s)).json() as { data: TestSupplier[] }).data.map((f) => f.name);

  it('cadastra só com o nome: o Zé da distribuidora não tem CNPJ à mão', async () => {
    const criado = await fornecedor({ name: 'Zé da Distribuidora' });
    expect(criado.document).toBeNull();
    expect(criado.categories).toEqual([]);
    expect(criado.preferredPartCount).toBe(0);
  });

  it('guarda contato, categorias, prazo e nota, com telefone normalizado', async () => {
    const criado = await fornecedor({
      name: 'Autopeças Central',
      document: CNPJ_VALIDO,
      contactName: 'Roberto',
      whatsapp: '(11) 98888-7777',
      categories: ['Freios', 'Suspensão', 'Freios'],
      leadTimeDays: 2,
      rating: 4,
    });
    expect(criado.document, 'sem pontuação').toBe('11222333000181');
    expect(criado.whatsapp, 'em E.164').toBe('+5511988887777');
    expect(criado.categories, 'categoria repetida entra uma vez').toEqual(['Freios', 'Suspensão']);
    expect(criado.leadTimeDays).toBe(2);
    expect(criado.rating).toBe(4);
  });

  it('aceita o CNPJ alfanumérico e recusa CNPJ inválido e nota fora de 1 a 5', async () => {
    const alfa = await fornecedor({ name: 'Distribuidora Nova', document: CNPJ_ALFANUMERICO });
    expect(alfa.document).toBe('12ABC34501DE35');

    const invalido = await post('/api/v1/suppliers', { name: 'Errado', document: '11.111.111/1111-11' });
    expect(invalido.statusCode, invalido.body).toBe(400);

    const nota = await post('/api/v1/suppliers', { name: 'Nota errada', rating: 6 });
    expect(nota.statusCode, nota.body).toBe(400);
  });

  it('o mesmo CNPJ não se repete na oficina', async () => {
    const repetido = await post('/api/v1/suppliers', { name: 'Outra Central', document: CNPJ_VALIDO });
    expect(repetido.statusCode, repetido.body).toBe(409);
    expect(repetido.json().code).toBe('SUPPLIER_DOCUMENT_TAKEN');
  });

  it('acha do jeito que a pessoa digita: sem acento, CNPJ, telefone ou vendedor', async () => {
    await fornecedor({ name: 'Mecânica Peças São Jorge', contactName: 'Márcia', phone: '(21) 3333-4444' });

    expect(await buscar('q=sao%20jorge'), 'sem acento').toContain('Mecânica Peças São Jorge');
    expect(await buscar('q=11222333'), 'pedaço do CNPJ').toContain('Autopeças Central');
    expect(await buscar('q=33334444'), 'pedaço do telefone').toContain('Mecânica Peças São Jorge');
    expect(await buscar('q=marcia'), 'nome do vendedor').toContain('Mecânica Peças São Jorge');
  });

  it('filtra por categoria sem ligar para maiúscula nem acento', async () => {
    const deFreio = await buscar('category=freios');
    expect(deFreio).toContain('Autopeças Central');
    expect(deFreio).not.toContain('Zé da Distribuidora');
    expect(await buscar('category=suspensao')).toContain('Autopeças Central');
  });

  it('edita sem apagar o que não foi enviado', async () => {
    const criado = await fornecedor({ name: 'Peças Rápidas', whatsapp: '(11) 97777-6666', leadTimeDays: 1 });
    const editado = await patch(`/api/v1/suppliers/${criado.id}`, { rating: 5 });
    expect(editado.statusCode, editado.body).toBe(200);
    expect(editado.json().rating).toBe(5);
    expect(editado.json().whatsapp, 'o WhatsApp continua lá').toBe('+5511977776666');
    expect(editado.json().leadTimeDays).toBe(1);
  });

  it('atendente consulta mas não cadastra; mecânico nem vê', async () => {
    const lista = await get('/api/v1/suppliers', atendente);
    expect(lista.statusCode, lista.body).toBe(200);
    expect((lista.json() as { data: unknown[] }).data.length).toBeGreaterThan(0);

    const cadastro = await post('/api/v1/suppliers', { name: 'Tentativa' }, atendente);
    expect(cadastro.statusCode).toBe(403);

    expect((await get('/api/v1/suppliers', mecanico)).statusCode).toBe(403);
  });

  it('oficina de fora não enxerga fornecedor nenhum: 404, nunca 403', async () => {
    const criado = await fornecedor({ name: 'Só Desta Oficina' });
    const vizinha = await signup(t.app);

    expect((await get(`/api/v1/suppliers/${criado.id}`, vizinha)).statusCode).toBe(404);
    expect((await patch(`/api/v1/suppliers/${criado.id}`, { rating: 1 }, vizinha)).statusCode).toBe(404);
    expect((await del(`/api/v1/suppliers/${criado.id}`, vizinha)).statusCode).toBe(404);
    expect(await buscar('q=', vizinha)).toEqual([]);
  });

  it('a peça guarda o fornecedor preferido e mostra o nome dele', async () => {
    const central = await fornecedor({ name: 'Freios & Cia', categories: ['Freios'] });
    const peca = await createPart(t.app, owner, { name: 'Pastilha dianteira', preferredSupplierId: central.id });

    const ficha = (await get(`/api/v1/parts/${peca.id}`)).json();
    expect(ficha.preferredSupplier).toEqual({ id: central.id, name: 'Freios & Cia' });

    const doFornecedor = (await get(`/api/v1/suppliers/${central.id}`)).json() as TestSupplier;
    expect(doFornecedor.preferredPartCount, 'a ficha do fornecedor conta a peça').toBe(1);

    // trocar e limpar pela edição da peça
    const outro = await fornecedor({ name: 'Segunda Opção' });
    const trocada = await patch(`/api/v1/parts/${peca.id}`, { preferredSupplierId: outro.id });
    expect(trocada.statusCode, trocada.body).toBe(200);
    expect(trocada.json().preferredSupplier.name).toBe('Segunda Opção');
    const limpa = await patch(`/api/v1/parts/${peca.id}`, { preferredSupplierId: null });
    expect(limpa.json().preferredSupplier).toBeNull();
  });

  it('a peça não aceita fornecedor de outra oficina', async () => {
    const vizinha = await signup(t.app);
    const deFora = await post('/api/v1/suppliers', { name: 'Fornecedor Alheio' }, vizinha);
    expect(deFora.statusCode, deFora.body).toBe(201);

    const tentativa = await post('/api/v1/parts', { name: 'Filtro', preferredSupplierId: deFora.json().id });
    expect(tentativa.statusCode, tentativa.body).toBe(400);
    expect(tentativa.json().errors[0].path).toBe('body.preferredSupplierId');
  });

  it('tirar da lista não quebra nada: a peça fica sem preferido e o CNPJ volta a valer', async () => {
    const descartado = await fornecedor({ name: 'Não Compro Mais', document: '45.723.174/0001-10' });
    const peca = await createPart(t.app, owner, { name: 'Correia', preferredSupplierId: descartado.id });

    const apagado = await del(`/api/v1/suppliers/${descartado.id}`);
    expect(apagado.statusCode, apagado.body).toBe(204);

    expect((await get(`/api/v1/suppliers/${descartado.id}`)).statusCode, 'sai da ficha').toBe(404);
    expect(await buscar('q=nao%20compro'), 'e da lista').toEqual([]);
    expect((await get(`/api/v1/parts/${peca.id}`)).json().preferredSupplier, 'a peça fica sem preferido').toBeNull();
    // e fica sem preferido NO BANCO, não só na tela: a cotação da E11 lê a coluna direto
    const { db } = testDb();
    const { rows } = await withTenant(db, { organizationId: owner.orgId }, (tx) =>
      tx.execute<{ preferred_supplier_id: string | null }>(
        sql`select preferred_supplier_id from parts where id = ${peca.id}`,
      ),
    );
    expect(rows[0]!.preferred_supplier_id).toBeNull();

    // e não dá para escolher de novo um fornecedor já descartado
    const volta = await patch(`/api/v1/parts/${peca.id}`, { preferredSupplierId: descartado.id });
    expect(volta.statusCode, volta.body).toBe(400);

    // o CNPJ de quem saiu pode ser cadastrado de novo
    const recadastro = await post('/api/v1/suppliers', { name: 'Voltou', document: '45.723.174/0001-10' });
    expect(recadastro.statusCode, recadastro.body).toBe(201);
  });
  it('mesmo que alguém apague o fornecedor por fora, a peça não o mostra como preferido', async () => {
    // a rede de segurança da leitura: um caminho futuro que apague sem limpar a peça
    const esquecido = await fornecedor({ name: 'Apagado Por Fora' });
    const peca = await createPart(t.app, owner, { name: 'Vela', preferredSupplierId: esquecido.id });
    const { db } = testDb();
    await withTenant(db, { organizationId: owner.orgId }, (tx) =>
      tx.execute(sql`update suppliers set deleted_at = now() where id = ${esquecido.id}`),
    );
    expect((await get(`/api/v1/parts/${peca.id}`)).json().preferredSupplier).toBeNull();
  });
});
