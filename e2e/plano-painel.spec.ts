import AxeBuilder from '@axe-core/playwright';
import { captura, criarOficina, entrarNoPainel, expect, test, textoDe, vencerOTesteDaOficina } from './helpers';

/**
 * Assinatura do SaaS (E20). O que este roteiro prova no navegador:
 * a oficina em teste vê quanto falta, assina, troca de plano e cancela — e a
 * tela deixa claro que **nenhuma cobrança é criada de verdade** enquanto o
 * gateway estiver em simulação.
 */
test('a oficina vê o teste correndo, assina, troca de plano e cancela', async ({ page }) => {
  const oficina = await criarOficina('plano', 'PLA1A23');

  await entrarNoPainel(page, oficina.email);

  await test.step('o painel mostra o teste correndo, com o caminho para o plano', async () => {
    await expect(page.getByText(/em teste/i).first()).toBeVisible();
    await page.getByRole('link', { name: 'Ver planos' }).click();
    await expect(page.getByRole('heading', { name: /^Plano Professional/ })).toBeVisible();
    const tela = await textoDe(page.locator('main'));
    expect(tela, 'a simulação é declarada').toContain('Cobrança em simulação');
    expect(tela, 'o uso do plano aparece').toContain('Pessoas na equipe');
    await captura(page, 'plano-01-teste');

    const auditoria = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(auditoria.violations.map((v) => `${v.id}: ${v.nodes.length}`), 'acessibilidade').toEqual([]);
  });

  await test.step('assinar o plano atual e trocar para outro', async () => {
    await page.getByRole('button', { name: 'Assinar' }).first().click();
    await expect(page.getByText('Assinatura criada.')).toBeVisible();

    await page.getByRole('button', { name: 'Mudar para este' }).last().click();
    await expect(page.getByText(/Plano alterado para/)).toBeVisible();
    await expect(page.getByRole('heading', { name: /^Plano Business/ })).toBeVisible();
    await captura(page, 'plano-02-assinado');
  });

  await test.step('cancelar deixa trabalhar até o fim do período, e dá para voltar', async () => {
    await page.getByRole('button', { name: 'Cancelar assinatura' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Cancelar assinatura' }).click();
    await expect(page.getByText('Assinatura cancelada.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Voltar a assinar' })).toBeVisible();
    await captura(page, 'plano-03-cancelada');

    await page.getByRole('button', { name: 'Reativar assinatura' }).click();
    await expect(page.getByText('Assinatura reativada.')).toBeVisible();
  });
});

/**
 * O outro lado da moeda: assinatura vencida trava a ESCRITA, mas a oficina
 * continua vendo tudo o que é dela. Trancar o dado de quem atrasou um boleto
 * seria sequestro de dado, não cobrança.
 */
test('com o teste vencido, a oficina lê tudo e é avisada do que fazer', async ({ page, ignorarErros }) => {
  ignorarErros.push(/status of 402/);
  const oficina = await criarOficina('bloqueio', 'BLO1A23');
  // o teste vence quando o relógio passa: aqui, empurramos o relógio da conta
  await vencerOTesteDaOficina(oficina.email);

  await entrarNoPainel(page, oficina.email);
  await expect(page.getByText('O período de teste terminou')).toBeVisible();
  await captura(page, 'plano-04-bloqueada');

  // ler: continua
  await page.goto('/clientes');
  await expect(page.getByRole('heading', { name: 'Clientes' })).toBeVisible();
  await expect(page.getByText('João Pereira')).toBeVisible();

  // gravar: a API recusa e a tela explica
  await page.goto('/configuracoes/plano');
  await expect(page.getByText('Acesso limitado')).toBeVisible();
});
