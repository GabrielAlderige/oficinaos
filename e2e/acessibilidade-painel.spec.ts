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
