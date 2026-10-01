import AxeBuilder from '@axe-core/playwright';
import { entrarNoPainel, expect, oficinaComMovimento, test } from './helpers';

/**
 * Auditoria básica de acessibilidade (critério de pronto da E9). Não substitui
 * teste com gente de verdade: pega o que dá para automatizar — contraste,
 * rótulo de campo, ordem de cabeçalho, nome acessível de botão e link.
 *
 * As telas são as que a oficina usa todo dia. `disableRules` ficaria fácil
 * demais: se algo aqui falhar, a tela é que se conserta.
 */
const TELAS = [
  { nome: 'início', caminho: '/' },
  { nome: 'agenda', caminho: '/agenda' },
  { nome: 'ordens de serviço', caminho: '/ordens' },
  { nome: 'clientes', caminho: '/clientes' },
  { nome: 'peças e estoque', caminho: '/pecas' },
  { nome: 'recomendações de pedido', caminho: '/pecas/recomendacoes' },
];

test('as telas do painel passam na auditoria automática', async ({ page }) => {
  // painel cheio de propósito: auditar tela vazia não prova quase nada
  const oficina = await oficinaComMovimento();
  await entrarNoPainel(page, oficina.email);

  for (const tela of TELAS) {
    await page.goto(tela.caminho);
    // esperar a tela assentar: auditar esqueleto de carregamento não diz nada
    await page.waitForLoadState('networkidle');
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const resumo = violations.map((v) => `${v.id} (${v.nodes.length}): ${v.help}`);
    expect(resumo, `violações em ${tela.nome}`).toEqual([]);
  }
});

/**
 * Nenhuma tela do painel rola de lado no celular.
 *
 * Rolagem horizontal não quebra nada e estraga o uso: a pessoa arrasta para
 * ler um número e perde a coluna da esquerda. Já aconteceu duas vezes por
 * motivos invisíveis no código — uma coluna de grid que não encolhia (grid
 * nasce com `min-width: auto`) e uma tabela de leitor de tela que não colapsava
 * com `sr-only`, porque tabela ignora `overflow`. Nos dois casos o código
 * parecia certo e só a medição no navegador acusou.
 */
test('o painel não rola de lado em tela estreita', async ({ page }) => {
  const oficina = await oficinaComMovimento();
  await entrarNoPainel(page, oficina.email);

  // 320px é o celular pequeno que ainda aparece; 390px é o comum
  for (const largura of [320, 390]) {
    await page.setViewportSize({ width: largura, height: 900 });
    for (const tela of TELAS) {
      await page.goto(tela.caminho);
      await page.waitForLoadState('networkidle');
      // medido pelo próprio <html>, que o Playwright entrega tipado — assim o
      // e2e não precisa das definições de DOM no seu tsconfig
      const rolagem = await page.locator('html').evaluate((raiz) => ({
        conteudo: raiz.scrollWidth,
        tela: raiz.clientWidth,
      }));
      expect(
        rolagem.conteudo,
        `${tela.nome} a ${largura}px: o conteúdo mede ${rolagem.conteudo}px numa tela de ${rolagem.tela}px`,
      ).toBeLessThanOrEqual(rolagem.tela);
    }
  }
});
