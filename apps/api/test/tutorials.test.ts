import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { addMember, bearer, createTestApp, signup, testDb, type TestApp, type TestSession } from './helpers';

interface Aula {
  id: string;
  slug: string;
  module: string;
  isPublished: boolean;
  videoUrl: string | null;
  embedUrl: string | null;
  watched: boolean;
}

interface Visao {
  modules: { module: string; lessons: Aula[]; watchedCount: number }[];
  totalLessons: number;
  watchedLessons: number;
  nextLessonId: string | null;
}

/**
 * Tutoriais em vídeo (E39) — conteúdo da PLATAFORMA.
 *
 * O que precisa ficar provado: a oficina assiste mas não cadastra (nem o
 * dono); rascunho não vaza; publicar sem vídeo é recusado; e o "já vi" é de
 * cada PESSOA, não da oficina — senão o dono marcar esconderia a aula do
 * mecânico que nunca a viu.
 */
describe('tutoriais', () => {
  let t: TestApp;
  let oficina: TestSession;
  let plataforma: TestSession;

  const post = (url: string, payload: unknown, s: TestSession) =>
    t.app.inject({ method: 'POST', url, headers: bearer(s.accessToken), payload: payload as never });
  const put = (url: string, payload: unknown, s: TestSession) =>
    t.app.inject({ method: 'PUT', url, headers: bearer(s.accessToken), payload: payload as never });
  const patch = (url: string, payload: unknown, s: TestSession) =>
    t.app.inject({ method: 'PATCH', url, headers: bearer(s.accessToken), payload: payload as never });
  const get = (url: string, s: TestSession) =>
    t.app.inject({ method: 'GET', url, headers: bearer(s.accessToken) });

  const novaAula = (slug: string, extra: Record<string, unknown> = {}) => ({
    module: 'PRIMEIROS_PASSOS',
    slug,
    title: `Aula ${slug}`,
    description: 'o que a pessoa sai sabendo',
    player: 'YOUTUBE',
    videoUrl: 'https://www.youtube.com/watch?v=abc123DEF45',
    durationSeconds: 180,
    position: 0,
    isPublished: true,
    ...extra,
  });

  beforeAll(async () => {
    t = await createTestApp();
    oficina = await signup(t.app);
    plataforma = await signup(t.app);
    // a marca é da CONTA, não do papel na oficina
    await testDb().db.execute(sql`update users set is_platform_admin = true where id = ${plataforma.userId}`);
  });
  afterAll(async () => {
    await t.app.close();
  });

  it('só administrador da plataforma cadastra: o dono da oficina recebe 403', async () => {
    const recusado = await post('/api/v1/tutorials/admin', novaAula('nao-deveria-entrar'), oficina);
    expect(recusado.statusCode).toBe(403);

    const aceito = await post('/api/v1/tutorials/admin', novaAula('primeira-aula'), plataforma);
    expect(aceito.statusCode).toBe(201);
    expect(aceito.json<Aula>().isPublished).toBe(true);
  });

  it('o link do YouTube vira endereço de incorporação', async () => {
    const { modules } = (await get('/api/v1/tutorials', oficina)).json<Visao>();
    const aula = modules.flatMap((m) => m.lessons).find((a) => a.slug === 'primeira-aula')!;
    // colar o link da barra de endereços no iframe dá tela cinza: a API converte
    expect(aula.embedUrl).toBe('https://www.youtube-nocookie.com/embed/abc123DEF45?rel=0');
  });

  it('publicar sem vídeo é recusado, e o rascunho não chega na oficina', async () => {
    const semVideo = await post(
      '/api/v1/tutorials/admin',
      novaAula('sem-video', { videoUrl: null, isPublished: true }),
      plataforma,
    );
    expect(semVideo.statusCode).toBe(400);

    const rascunho = await post(
      '/api/v1/tutorials/admin',
      novaAula('rascunho', { videoUrl: null, isPublished: false }),
      plataforma,
    );
    expect(rascunho.statusCode).toBe(201);

    const daOficina = (await get('/api/v1/tutorials', oficina)).json<Visao>();
    const slugs = daOficina.modules.flatMap((m) => m.lessons).map((a) => a.slug);
    expect(slugs).not.toContain('rascunho');

    // quem preenche precisa enxergar o rascunho, senão não há como terminá-lo
    const daPlataforma = (await get('/api/v1/tutorials/admin', plataforma)).json<Visao>();
    expect(daPlataforma.modules.flatMap((m) => m.lessons).map((a) => a.slug)).toContain('rascunho');
  });

  it('despublicar tira a aula da oficina sem apagar o vídeo', async () => {
    const criada = (
      await post('/api/v1/tutorials/admin', novaAula('vai-e-volta'), plataforma)
    ).json<Aula>();

    const escondida = await patch(`/api/v1/tutorials/admin/${criada.id}`, { isPublished: false }, plataforma);
    expect(escondida.statusCode).toBe(200);
    // o PATCH parcial não pode apagar o vídeo que já estava gravado
    expect(escondida.json<Aula>().videoUrl).toBe('https://www.youtube.com/watch?v=abc123DEF45');

    const visivel = (await get('/api/v1/tutorials', oficina)).json<Visao>();
    expect(visivel.modules.flatMap((m) => m.lessons).map((a) => a.slug)).not.toContain('vai-e-volta');
  });

  it('"já vi" é de cada PESSOA, mesmo dentro da mesma oficina', async () => {
    // o mecânico da MESMA oficina é o caso que importa: se o progresso fosse
    // da oficina, o dono marcar esconderia a aula de quem nunca a viu
    const mecanico = await addMember(t.app, oficina, 'MECHANIC');
    const outraOficina = await signup(t.app);

    const antes = (await get('/api/v1/tutorials', oficina)).json<Visao>();
    const alvo = antes.nextLessonId!;
    expect(alvo).not.toBeNull();
    expect(antes.watchedLessons).toBe(0);

    const marcada = (await put(`/api/v1/tutorials/${alvo}/visto`, { watched: true }, oficina)).json<Visao>();
    expect(marcada.watchedLessons).toBe(1);
    expect(marcada.nextLessonId).not.toBe(alvo);

    const doMecanico = (await get('/api/v1/tutorials', mecanico)).json<Visao>();
    expect(doMecanico.watchedLessons, 'o dono ter visto não marca o mecânico').toBe(0);
    expect(doMecanico.nextLessonId).toBe(alvo);

    // e continua isolado entre oficinas
    const deOutra = (await get('/api/v1/tutorials', outraOficina)).json<Visao>();
    expect(deOutra.watchedLessons).toBe(0);

    // desmarcar volta ao estado anterior
    const desmarcada = (await put(`/api/v1/tutorials/${alvo}/visto`, { watched: false }, oficina)).json<Visao>();
    expect(desmarcada.watchedLessons).toBe(0);
  });

  it('marcar duas vezes não conta duas vezes', async () => {
    const visao = (await get('/api/v1/tutorials', oficina)).json<Visao>();
    const alvo = visao.nextLessonId!;
    await put(`/api/v1/tutorials/${alvo}/visto`, { watched: true }, oficina);
    const depois = (await put(`/api/v1/tutorials/${alvo}/visto`, { watched: true }, oficina)).json<Visao>();
    expect(depois.watchedLessons).toBe(1);
  });

  it('a oficina não apaga aula', async () => {
    const visao = (await get('/api/v1/tutorials', oficina)).json<Visao>();
    const alvo = visao.modules.flatMap((m) => m.lessons)[0]!.id;
    const recusado = await t.app.inject({
      method: 'DELETE',
      url: `/api/v1/tutorials/admin/${alvo}`,
      headers: bearer(oficina.accessToken),
    });
    expect(recusado.statusCode).toBe(403);
  });
});
