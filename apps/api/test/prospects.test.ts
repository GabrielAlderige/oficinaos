import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { bearer, createTestApp, postPublic, signup, testDb, type TestApp, type TestSession } from './helpers';

interface Interessado {
  id: string;
  name: string;
  phone: string;
  email: string;
  source: string;
  contactedAt: string | null;
}
interface Visao {
  prospects: Interessado[];
  total: number;
  aguardando: number;
  daSemana: number;
}

/**
 * Interessados vindos da landing (E42).
 *
 * O que precisa ficar provado: o formulário do site grava sem login; o
 * telefone entra só com dígitos (senão a planilha do remarketing vira
 * bagunça); o campo-armadilha descarta robô **sem** avisar que descartou; a
 * lista e a planilha são só do administrador da plataforma; e a role da
 * aplicação não consegue apagar interessado nenhum.
 */
describe('interessados da landing', () => {
  let t: TestApp;
  let oficina: TestSession;
  let plataforma: TestSession;

  beforeAll(async () => {
    t = await createTestApp();
    oficina = await signup(t.app);
    plataforma = await signup(t.app);
    await testDb().db.execute(sql`update users set is_platform_admin = true where id = ${plataforma.userId}`);
  });
  afterAll(async () => {
    await t.app.close();
  });

  const enviar = (payload: Record<string, unknown>) => postPublic(t.app, '/api/v1/prospects', payload);
  const visao = async () => {
    const r = await t.app.inject({
      method: 'GET',
      url: '/api/v1/prospects',
      headers: bearer(plataforma.accessToken),
    });
    expect(r.statusCode, r.body).toBe(200);
    return r.json<Visao>();
  };

  it('o site grava o interessado sem login nenhum', async () => {
    const r = await enviar({
      name: 'Marcos da Oficina',
      phone: '(35) 99841-6972',
      email: 'MARCOS@Exemplo.invalido',
      workshopName: 'Auto Center Marcos',
      message: 'quero ver funcionando',
    });
    expect(r.statusCode, r.body).toBe(201);

    const dados = await visao();
    const dele = dados.prospects.find((p) => p.name === 'Marcos da Oficina')!;
    expect(dele, 'o interessado tem de estar na lista').toBeDefined();
    // só dígitos: é o que faz a planilha abrir sem o telefone virar número quebrado
    expect(dele.phone, 'a máscara não vai para o banco').toBe('35998416972');
    expect(dele.email, 'e-mail normalizado').toBe('marcos@exemplo.invalido');
    expect(dele.source).toBe('LANDING');
    expect(dele.contactedAt, 'ninguém foi chamado ainda').toBeNull();
  });

  it('o e-mail é opcional: dono de oficina responde no WhatsApp', async () => {
    const r = await enviar({ name: 'Sem e-mail', phone: '35999998888' });
    expect(r.statusCode, 'exigir e-mail derruba a conversão por um campo que não é usado').toBe(201);
  });

  it('telefone sem DDD é recusado, com o motivo', async () => {
    const r = await enviar({ name: 'Telefone curto', phone: '99841' });
    expect(r.statusCode).toBe(400);
    expect(r.body).toContain('DDD');
  });

  it('o campo-armadilha descarta o robô SEM dizer que descartou', async () => {
    const antes = (await visao()).total;
    const r = await enviar({
      name: 'Robô de Spam',
      phone: '11999999999',
      website: 'http://spam.example',
    });
    // 201 de propósito: responder "recusado" ensina o robô a contornar
    expect(r.statusCode, 'a resposta é igual à de sucesso').toBe(201);

    const depois = await visao();
    expect(depois.total, 'mas nada foi gravado').toBe(antes);
    expect(depois.prospects.some((p) => p.name === 'Robô de Spam')).toBe(false);
  });

  it('a lista e a planilha são só do administrador da plataforma', async () => {
    const daOficina = await t.app.inject({
      method: 'GET',
      url: '/api/v1/prospects',
      headers: bearer(oficina.accessToken),
    });
    expect(daOficina.statusCode, 'nem o dono da oficina vê os interessados').toBe(403);

    const planilha = await t.app.inject({
      method: 'GET',
      url: '/api/v1/prospects/csv',
      headers: bearer(oficina.accessToken),
    });
    expect(planilha.statusCode).toBe(403);
  });

  it('a planilha abre no Excel em português, com ponto-e-vírgula e BOM', async () => {
    const r = await t.app.inject({
      method: 'GET',
      url: '/api/v1/prospects/csv',
      headers: bearer(plataforma.accessToken),
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.headers['content-disposition']).toContain('interessados-');

    // sem BOM o acento quebra; com vírgula o Excel joga tudo numa coluna só
    expect(r.body.startsWith('﻿'), 'BOM na frente').toBe(true);
    const conteudo = r.body.slice(1); // tira o BOM
    const primeiraLinha = conteudo.split(String.fromCharCode(13, 10))[0];
    expect(primeiraLinha).toBe(
      '"Nome";"WhatsApp";"E-mail";"Oficina";"Mensagem";"Origem";"Entrou em";"Contatado em";"Observação"',
    );
    // o telefone sai legível na planilha, não como 35998416972
    expect(conteudo, 'telefone formatado para quem vai ligar').toContain('"(35) 99841-6972"');
  });

  it('marcar como contatado tira da fila do remarketing', async () => {
    const dados = await visao();
    const alvo = dados.prospects.find((p) => p.name === 'Marcos da Oficina')!;
    const aguardandoAntes = dados.aguardando;

    const r = await t.app.inject({
      method: 'PATCH',
      url: `/api/v1/prospects/${alvo.id}`,
      headers: bearer(plataforma.accessToken),
      payload: { contacted: true, notes: 'ligou, quer ver na terça' },
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json<Interessado>().contactedAt).not.toBeNull();

    const depois = await visao();
    expect(depois.aguardando, 'saiu da fila').toBe(aguardandoAntes - 1);
    expect(depois.total, 'mas continua na lista').toBe(dados.total);
  });

  it('a role da aplicação não apaga interessado, mas marca como contatado', async () => {
    // a rota pública que insere aqui é aberta para a internet inteira. Se um
    // dia alguém abusar dela, o pior que pode acontecer é sujar a lista —
    // nunca apagar os interessados que já entraram, que é o ativo comercial.
    //
    // Não basta `REVOKE ... FROM PUBLIC`: o db-setup concede DELETE à role da
    // aplicação por ALTER DEFAULT PRIVILEGES, que é grant explícito e não sai
    // com revoke do PUBLIC. A migration revoga de cada role concedida.
    const { db } = testDb();
    // o driver embrulha a mensagem do Postgres, então o que se prova é que
    // DELETE é recusado enquanto SELECT na mesma tabela funciona — se fosse
    // tabela faltando, os dois falhariam
    await expect(db.execute(sql`delete from prospects`)).rejects.toThrow();
    await expect(db.execute(sql`select count(*) from prospects`)).resolves.toBeDefined();

    // e o UPDATE continua: é ele que marca contatado
    await expect(db.execute(sql`update prospects set notes = notes`)).resolves.toBeDefined();
  });
});
