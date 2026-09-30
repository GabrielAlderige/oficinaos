import { afterAll, describe, expect, it } from 'vitest';
import { bearer, createTestApp, TEST_ORIGIN, TEST_PASSWORD, uniqueEmail } from './helpers';

/**
 * O IP verdadeiro do cliente, atrás do proxy (E41).
 *
 * Em produção a API roda atrás do Caddy. Sem `trustProxy`, o Fastify ignora o
 * `X-Forwarded-For` e lê o IP do socket — que é sempre o do contêiner do
 * proxy. Nenhum teste pegava isso porque em teste não existe proxy: era um
 * bug que só aparecia depois de publicado, e em silêncio.
 *
 * O que quebra sem isto, e por que cada um importa:
 *
 *  - **Limite por IP**: são 300 requisições por minuto por IP em produção.
 *    Com todo mundo no mesmo IP, vira um balde compartilhado entre TODAS as
 *    oficinas — duas movimentadas e a terceira toma 429 sem ter feito nada.
 *  - **Sessões ativas**: a tela mostra o IP de cada sessão para o dono
 *    perceber acesso estranho. Com um IP só, ela para de servir para isso.
 *  - **Prova de aprovação do orçamento**: o IP de quem aprovou é gravado como
 *    prova. Um IP interno do Docker não prova nada.
 */
describe('IP do cliente atrás do proxy', () => {
  const apps: { close(): Promise<void> }[] = [];
  afterAll(async () => {
    await Promise.all(apps.map((app) => app.close()));
  });

  /**
   * Cria a conta ATRAVÉS do proxy: o cabeçalho vai na própria requisição que
   * abre a sessão, porque é ali que o IP é gravado. Mandar o cabeçalho só na
   * leitura não provaria nada — a sessão já teria nascido com o IP do socket.
   */
  const ipDaSessao = async (trustProxy: string, forwarded: string, socket = '172.18.0.4') => {
    const t = await createTestApp({ TRUST_PROXY: trustProxy });
    apps.push(t.app);

    const criada = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      headers: { origin: TEST_ORIGIN, 'x-forwarded-for': forwarded },
      // o socket é sempre o mesmo, como seria o do contêiner do Caddy
      remoteAddress: socket,
      payload: {
        name: 'Dono Teste',
        email: uniqueEmail('proxy'),
        password: TEST_PASSWORD,
        organizationName: 'Oficina do Proxy',
        whatsapp: '(11) 98765-4321',
      },
    });
    expect(criada.statusCode, criada.body).toBe(201);
    const { accessToken } = criada.json<{ accessToken: string }>();

    const resposta = await t.app.inject({
      method: 'GET',
      url: '/api/v1/auth/sessions',
      headers: bearer(accessToken),
    });
    expect(resposta.statusCode, resposta.body).toBe(200);
    return resposta.json<{ data: { ip: string | null }[] }>().data;
  };

  it('atrás do proxy, a API lê o IP do cliente e não o do contêiner', async () => {
    // o Caddy está na rede privada do compose (172.18.x) e encaminha o IP real
    const sessoes = await ipDaSessao('uniquelocal', '201.17.44.9');
    expect(sessoes.length).toBeGreaterThan(0);
    expect(sessoes[0]!.ip, 'o IP do cliente tem de chegar inteiro').toBe('201.17.44.9');
  });

  it('cliente público não consegue forjar o próprio IP', async () => {
    // a parte que faz `uniquelocal` ser melhor do que `true`: quem chega de um
    // endereço público não tem o cabeçalho respeitado, senão qualquer um
    // escaparia do limite por IP inventando um endereço a cada requisição
    const sessoes = await ipDaSessao('uniquelocal', '201.17.44.9', '203.0.113.7');
    expect(sessoes[0]!.ip, 'o cabeçalho de fora da rede privada é ignorado').toBe('203.0.113.7');
  });

  it('sem TRUST_PROXY, o cabeçalho encaminhado é ignorado', async () => {
    const sessoes = await ipDaSessao('', '10.9.9.9');
    expect(sessoes[0]!.ip, 'sem proxy declarado, vale o socket').toBe('172.18.0.4');
  });
});
