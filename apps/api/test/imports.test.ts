import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, bearer, createTestApp, signup, type TestApp, type TestSession } from './helpers';

interface Resultado {
  kind: string;
  dryRun: boolean;
  total: number;
  created: number;
  updated: number;
  skipped: number;
  problems: { line: number; reason: string; value: string | null }[];
  preview: Record<string, string>[];
}

/**
 * Importação de planilha (E17). O que precisa ficar provado: a conferência
 * não grava NADA, a linha ruim não derruba o arquivo, o mesmo documento não
 * vira dois clientes, e o veículo acha o dono pelo documento, pelo telefone
 * ou pelo nome.
 */
describe('importação de planilha', () => {
  let t: TestApp;
  let dono: TestSession;
  let mecanico: TestSession;

  const post = (url: string, payload: unknown = {}, s: TestSession = dono) =>
    t.app.inject({ method: 'POST', url, headers: bearer(s.accessToken), payload: payload as never });
  const get = (url: string, s: TestSession = dono) => t.app.inject({ method: 'GET', url, headers: bearer(s.accessToken) });

  const importar = async (kind: string, csv: string, dryRun = false, s: TestSession = dono) => {
    const res = await post(`/api/v1/imports/${kind}`, { csv, dryRun }, s);
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as Resultado;
  };

  beforeAll(async () => {
    t = await createTestApp();
    dono = await signup(t.app);
    mecanico = await addMember(t.app, dono, 'MECHANIC', 'Zé Mecânico');
  });
  afterAll(async () => {
    await t.app.close();
  });

  it('a conferência mostra o que vai acontecer e NÃO grava nada', async () => {
    const csv = 'nome;whatsapp;documento\nJoão Pereira;(11) 91234-5678;390.533.447-05';
    const ensaio = await importar('customers', csv, true);
    expect(ensaio).toMatchObject({ dryRun: true, total: 1, created: 1, skipped: 0 });
    expect(ensaio.preview[0]).toMatchObject({ nome: 'João Pereira', whatsapp: '+5511912345678' });

    const lista = await get('/api/v1/customers?q=João');
    expect((lista.json() as { data: unknown[] }).data, 'o ensaio não gravou').toHaveLength(0);

    const valendo = await importar('customers', csv);
    expect(valendo).toMatchObject({ dryRun: false, created: 1 });
    expect((await get('/api/v1/customers?q=João')).json().data).toHaveLength(1);
  });

  it('linha ruim não derruba o arquivo: volta com o número da linha e o motivo', async () => {
    const csv = [
      'nome;documento',
      'Maria Souza;111.222.333-44',
      ';999',
      'Carlos Lima;',
    ].join('\n');
    const resultado = await importar('customers', csv);
    expect(resultado.created, 'só o Carlos entra: a Maria tem CPF inválido').toBe(1);
    expect(resultado.skipped).toBe(2);
    expect(resultado.problems).toEqual([
      { line: 2, reason: 'documento inválido: "111.222.333-44"', value: 'Maria Souza' },
      { line: 3, reason: 'sem nome', value: null },
    ]);
  });

  it('o mesmo CPF não vira dois clientes: atualiza o que já existe', async () => {
    const primeira = await importar('customers', 'nome;documento\nAna Paula;529.982.247-25');
    expect(primeira.created).toBe(1);
    const segunda = await importar('customers', 'nome;documento;whatsapp\nAna Paula Souza;529.982.247-25;(11) 95555-4444');
    expect(segunda).toMatchObject({ created: 0, updated: 1 });

    const lista = (await get('/api/v1/customers?q=Ana')).json() as { data: { name: string }[] };
    expect(lista.data).toHaveLength(1);
    expect(lista.data[0]!.name).toBe('Ana Paula Souza');
  });

  it('o veículo acha o dono pelo documento, pelo telefone ou pelo nome — e recusa sem dono', async () => {
    const csv = [
      'placa;marca;modelo;ano;cliente;documento;telefone',
      'ABC1D23;Fiat;Argo;2020;;529.982.247-25;',
      'XYZ4H56;VW;Gol;2015;;;(11) 91234-5678',
      'QWE7J89;Honda;Civic;2019;Carlos Lima;;',
      'RTY1K11;Toyota;Corolla;2021;Fantasma da Silva;;',
      'placa-errada;Ford;Ka;2018;Carlos Lima;;',
    ].join('\n');
    const resultado = await importar('vehicles', csv);
    expect(resultado.created, 'três acharam o dono').toBe(3);
    expect(resultado.skipped).toBe(2);
    expect(resultado.problems.map((problema) => problema.line)).toEqual([5, 6]);
    expect(resultado.problems[0]!.reason).toContain('cliente não encontrado');
    expect(resultado.problems[1]!.reason).toContain('placa inválida');

    const busca = (await get('/api/v1/vehicles?q=ABC1D23')).json() as { data: { plate: string }[] };
    expect(busca.data[0]!.plate).toBe('ABC1D23');
  });

  it('as peças entram com preço, custo e saldo, e o SKU repetido atualiza', async () => {
    const csv = [
      'nome;sku;codigo;marca;preco;custo;quantidade;minimo',
      'Filtro de óleo;FL-01;W712;Mann;R$ 45,90;24,00;12;4',
      'Pastilha de freio;PF-01;PD-220;Bosch;189,90;120,00;6;2',
      'Sem preço mesmo;SP-01;;;;;3;1',
    ].join('\n');
    const resultado = await importar('parts', csv);
    expect(resultado.created).toBe(3);

    const lista = (await get('/api/v1/parts?q=Filtro')).json() as {
      data: { name: string; sku: string; quantityOnHand: number; salePriceCents: number | null }[];
    };
    expect(lista.data[0]).toMatchObject({ sku: 'FL-01', quantityOnHand: 12, salePriceCents: 4_590 });

    const denovo = await importar('parts', 'nome;sku;preco\nFiltro de óleo premium;FL-01;49,90');
    expect(denovo).toMatchObject({ created: 0, updated: 1 });
    expect((await get('/api/v1/parts?q=premium')).json().data[0].salePriceCents).toBe(4_990);
  });

  it('planilha vazia ou gigante é recusada com o motivo', async () => {
    const vazia = await post('/api/v1/imports/customers', { csv: 'nome;documento\n', dryRun: true });
    expect(vazia.statusCode).toBe(422);
    expect(vazia.json().title).toBe('Planilha vazia');

    const linhas = ['nome', ...Array.from({ length: 5_001 }, (_, i) => `Cliente ${i}`)].join('\n');
    const gigante = await post('/api/v1/imports/customers', { csv: linhas, dryRun: true });
    expect(gigante.statusCode).toBe(422);
    expect(gigante.json().detail).toContain('Divida o arquivo');
  });

  it('importar é de quem cadastra: o mecânico não importa nada', async () => {
    expect((await post('/api/v1/imports/customers', { csv: 'nome\nX', dryRun: true }, mecanico)).statusCode).toBe(403);
    expect((await post('/api/v1/imports/parts', { csv: 'nome\nX', dryRun: true }, mecanico)).statusCode).toBe(403);
  });

  it('a importação de uma oficina não enxerga a outra', async () => {
    const outra = await signup(t.app, { organizationName: 'Oficina Vizinha' });
    await importar('customers', 'nome;documento\nCliente da vizinha;529.982.247-25', false, outra);
    const meus = (await get('/api/v1/customers?q=vizinha')).json() as { data: unknown[] };
    expect(meus.data).toHaveLength(0);
  });
});
