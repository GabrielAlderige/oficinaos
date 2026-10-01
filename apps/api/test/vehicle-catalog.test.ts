import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { bearer, createTestApp, signup, testDb, type TestApp, type TestSession } from './helpers';

interface Ficha {
  id: string;
  make: string;
  model: string;
  isPublished: boolean;
  filledCount: number;
  specs: { key: string; customLabel: string; group: string; value: string }[];
}

/**
 * Ficha do carro (E31) — o catálogo da PLATAFORMA.
 *
 * O que precisa ficar provado: a oficina lê, mas não escreve (nem o dono);
 * rascunho não vaza para a oficina; e o pedido "não achei meu carro" vira uma
 * fila que conta oficinas, não cliques.
 */
describe('ficha do carro', () => {
  let t: TestApp;
  let oficina: TestSession;
  let plataforma: TestSession;
  let ficha: Ficha;

  const post = (url: string, payload: unknown, s: TestSession) =>
    t.app.inject({ method: 'POST', url, headers: bearer(s.accessToken), payload: payload as never });
  const patch = (url: string, payload: unknown, s: TestSession) =>
    t.app.inject({ method: 'PATCH', url, headers: bearer(s.accessToken), payload: payload as never });
  const get = (url: string, s: TestSession) =>
    t.app.inject({ method: 'GET', url, headers: bearer(s.accessToken) });

  beforeAll(async () => {
    t = await createTestApp();
    oficina = await signup(t.app);
    plataforma = await signup(t.app);
    // a marca é da CONTA, não do papel na oficina: não há tela que a conceda
    await testDb().db.execute(
      sql`update users set is_platform_admin = true where id = ${plataforma.userId}`,
    );
  });
  afterAll(async () => {
    await t.app.close();
  });

  it('só a plataforma cria ficha — nem o dono da oficina', async () => {
    const corpo = {
      make: 'Volkswagen',
      model: 'Gol',
      version: 'G6 1.0',
      yearFrom: 2013,
      yearTo: 2016,
      specs: [
        { key: 'oleo_motor', group: 'MOTOR', value: '5W30 sintético · 3,5 L' },
        { key: 'pastilha_dianteira', group: 'FREIOS', value: 'Cobreq N-1234' },
      ],
    };
    const recusado = await post('/api/v1/vehicle-catalog', corpo, oficina);
    expect(recusado.statusCode, 'dono da oficina não mexe no catálogo de todo mundo').toBe(403);

    const criado = await post('/api/v1/vehicle-catalog', corpo, plataforma);
    expect(criado.statusCode, criado.body).toBe(201);
    ficha = criado.json() as Ficha;
    expect(ficha.isPublished, 'nasce rascunho: meia ficha é pior que ficha nenhuma').toBe(false);
    expect(ficha.filledCount).toBe(2);
  });

  it('rascunho não aparece para a oficina, publicada aparece', async () => {
    const escondida = await get('/api/v1/vehicle-catalog?q=gol', oficina);
    expect((escondida.json() as { data: Ficha[] }).data, 'rascunho não vaza').toHaveLength(0);
    expect((await get(`/api/v1/vehicle-catalog/${ficha.id}`, oficina)).statusCode).toBe(404);

    // quem preenche enxerga o próprio rascunho
    const paraQuemPreenche = await get('/api/v1/vehicle-catalog?q=gol&incluirRascunhos=true', plataforma);
    expect((paraQuemPreenche.json() as { data: Ficha[] }).data).toHaveLength(1);

    await patch(`/api/v1/vehicle-catalog/${ficha.id}`, { isPublished: true }, plataforma);
    const publicada = await get('/api/v1/vehicle-catalog?q=gol', oficina);
    expect((publicada.json() as { data: Ficha[] }).data, 'agora sim').toHaveLength(1);
  });

  it('a busca acha pelo modelo e pelo ano dentro da faixa', async () => {
    const porAno = await get('/api/v1/vehicle-catalog?q=gol%202015', oficina);
    expect((porAno.json() as { data: Ficha[] }).data, '2015 está entre 2013 e 2016').toHaveLength(1);

    const foraDaFaixa = await get('/api/v1/vehicle-catalog?q=gol%202020', oficina);
    expect((foraDaFaixa.json() as { data: Ficha[] }).data, 'e 2020 não está').toHaveLength(0);
  });

  /**
   * Chassi no mesmo campo da busca (E43).
   *
   * O chassi entrega marca e ano — nunca o modelo. O que precisa ficar travado
   * aqui é o ano: o código repete de 30 em 30 anos e o chassi não desempata,
   * então a ficha serve se cobrir QUALQUER um dos candidatos. Filtrar só pelo
   * mais recente esconderia a ficha do carro velho de quem tem um no elevador.
   */
  describe('busca por chassi', () => {
    // 9BW = Volkswagen do Brasil. A 10ª posição é o ano-modelo
    const vinVw = (ano: string) => `9BWZZZ377${ano}T004251`;

    it('filtra por marca e ano do chassi, sem inventar o modelo', async () => {
      // 'D' é 2013 (e 1983): pega o Gol 2013-2016 criado acima
      const achou = await get(`/api/v1/vehicle-catalog?q=${vinVw('D')}`, oficina);
      const corpo = achou.json() as { data: Ficha[]; chassi: { make: string; years: number[]; resumo: string } };
      expect(corpo.chassi.make).toBe('Volkswagen');
      expect(corpo.chassi.years, 'os dois candidatos do ciclo, sem chute').toEqual([2013, 1983]);
      expect(corpo.data.map((f) => f.model)).toContain('Gol');
      // a tela precisa poder explicar por que a lista encolheu
      expect(corpo.chassi.resumo).toBe('Volkswagen, ano-modelo 1983 ou 2013');
    });

    it('marca errada no chassi não traz a ficha', async () => {
      // 9BG é Chevrolet: o Gol não pode aparecer
      const outra = await get('/api/v1/vehicle-catalog?q=9BGZZZ377DT004251', oficina);
      expect((outra.json() as { data: Ficha[] }).data.map((f) => f.model)).not.toContain('Gol');
    });

    it('acha a ficha do carro VELHO pelo candidato antigo do ciclo', async () => {
      // uma ficha que só existe no passado: fecha em 2000
      const antiga = await post(
        '/api/v1/vehicle-catalog',
        {
          make: 'Volkswagen',
          model: 'Quantum',
          yearFrom: 1997,
          yearTo: 2000,
          specs: [{ key: 'oleo_motor', group: 'MOTOR', value: '20W50 mineral · 4,0 L' }],
        },
        plataforma,
      );
      expect(antiga.statusCode, antiga.body).toBe(201);
      await patch(`/api/v1/vehicle-catalog/${(antiga.json() as Ficha).id}`, { isPublished: true }, plataforma);

      // 'V' é 1997 e 2027. Só o 1997 alcança o Quantum
      const achou = await get(`/api/v1/vehicle-catalog?q=${vinVw('V')}`, oficina);
      const corpo = achou.json() as { data: Ficha[]; chassi: { years: number[] } };
      expect(corpo.chassi.years).toEqual([2027, 1997]);
      expect(
        corpo.data.map((f) => f.model),
        'chutar 2027 esconderia o Quantum de quem tem um na oficina',
      ).toContain('Quantum');
      expect(
        corpo.data.map((f) => f.model),
        'e o filtro continua filtrando: 2013-2016 não cobre 1997 nem 2027',
      ).not.toContain('Gol');
    });

    it('fabricante desconhecido não vira chute de marca', async () => {
      const achou = await get('/api/v1/vehicle-catalog?q=ZZZZZZ377DT004251', oficina);
      const corpo = achou.json() as { data: Ficha[]; chassi: { make: string | null; resumo: string } };
      expect(corpo.chassi.make, 'melhor não reconhecer do que mostrar a ficha de outro carro').toBeNull();
      expect(corpo.chassi.resumo).toContain('marca não reconhecida');
      // sem filtro de marca, o ano ainda vale: o Gol 2013-2016 cobre 2013
      expect(corpo.data.map((f) => f.model)).toContain('Gol');
    });

    it('texto que não é chassi continua busca comum', async () => {
      const achou = await get('/api/v1/vehicle-catalog?q=gol', oficina);
      expect((achou.json() as { chassi?: unknown }).chassi, 'sem faixa de chassi na tela').toBeUndefined();
    });
  });

  it('a oficina lê a ficha inteira, com a especificação', async () => {
    const lida = (await get(`/api/v1/vehicle-catalog/${ficha.id}`, oficina)).json() as Ficha;
    expect(lida.specs.find((s) => s.key === 'oleo_motor')?.value).toBe('5W30 sintético · 3,5 L');
  });

  it('item fora da lista fixa é recusado, mas item extra com rótulo passa', async () => {
    const inventado = await patch(
      `/api/v1/vehicle-catalog/${ficha.id}`,
      { specs: [{ key: 'oleo_de_cotovelo', group: 'MOTOR', value: 'muito' }] },
      plataforma,
    );
    expect(inventado.statusCode, 'chave desconhecida quebraria a leitura da tela').toBe(400);

    const extra = await patch(
      `/api/v1/vehicle-catalog/${ficha.id}`,
      {
        specs: [
          { key: 'oleo_motor', group: 'MOTOR', value: '5W30 sintético · 3,5 L' },
          { customLabel: 'Parafuso do cárter', group: 'MOTOR', value: 'M14 · arruela nova sempre' },
        ],
      },
      plataforma,
    );
    expect(extra.statusCode, extra.body).toBe(200);
    expect((extra.json() as Ficha).specs.map((s) => s.customLabel)).toContain('Parafuso do cárter');
  });

  it('o carro que não existe vira fila, e a mesma oficina não conta duas vezes', async () => {
    const pedido = { make: 'Fiat', model: 'Toro', year: 2020 };
    expect((await post('/api/v1/vehicle-catalog/requests', pedido, oficina)).statusCode).toBe(202);
    expect((await post('/api/v1/vehicle-catalog/requests', pedido, oficina)).statusCode, 'insistir não fura a fila').toBe(202);

    const outra = await signup(t.app);
    await post('/api/v1/vehicle-catalog/requests', pedido, outra);

    const semPermissao = await get('/api/v1/vehicle-catalog/requests/queue', oficina);
    expect(semPermissao.statusCode, 'a fila é de quem preenche').toBe(403);

    const fila = (await get('/api/v1/vehicle-catalog/requests/queue', plataforma)).json() as {
      data: { make: string; model: string; requestCount: number }[];
    };
    const toro = fila.data.find((linha) => linha.model === 'Toro');
    expect(toro?.requestCount, 'duas oficinas diferentes, não três cliques').toBe(2);
  });

  /**
   * De onde veio o valor (E35). Um catálogo de especificação sem origem é
   * palpite com cara de certeza — e quem está de macacão não tem como julgar.
   */
  it('cada especificação carrega a fonte, e a tela avisa quando falta', async () => {
    const comFonte = await patch(
      `/api/v1/vehicle-catalog/${ficha.id}`,
      {
        specs: [
          {
            key: 'oleo_motor',
            group: 'MOTOR',
            value: 'Norma VW 508 88',
            source: 'Manual de instruções Gol (VW Brasil, ed. 2022), pág. 216',
          },
          { key: 'pastilha_dianteira', group: 'FREIOS', value: 'Cobreq N-1234' },
        ],
      },
      plataforma,
    );
    expect(comFonte.statusCode, comFonte.body).toBe(200);

    const lida = (await get(`/api/v1/vehicle-catalog/${ficha.id}`, oficina)).json() as {
      specs: { key: string; source: string }[];
    };
    expect(lida.specs.find((s) => s.key === 'oleo_motor')?.source).toContain('Manual de instruções Gol');
    expect(
      lida.specs.find((s) => s.key === 'pastilha_dianteira')?.source,
      'sem fonte volta vazio, e a tela transforma isso em aviso',
    ).toBe('');
  });

  it('a cobertura conta só o que está publicado', async () => {
    const antes = (await get('/api/v1/vehicle-catalog/coverage', oficina)).json() as { publishedVehicles: number };
    await post(
      '/api/v1/vehicle-catalog',
      { make: 'Chevrolet', model: 'Onix', specs: [] },
      plataforma,
    );
    const depois = (await get('/api/v1/vehicle-catalog/coverage', oficina)).json() as { publishedVehicles: number };
    expect(depois.publishedVehicles, 'rascunho não entra na conta que a tela promete').toBe(antes.publishedVehicles);
  });
});
