import AxeBuilder from '@axe-core/playwright';
import { api, captura, criarOficina, entrarNoPainel, expect, test, textoDe } from './helpers';

/**
 * Automações (E21). O que este roteiro prova no navegador: a oficina vê o que
 * o sistema faz sozinho, liga e desliga cada coisa, e o botão "Rodar agora"
 * mostra o efeito na hora — sem esperar o amanhecer e sem mandar mensagem
 * nenhuma para o cliente.
 */
test('a oficina configura as automações e vê uma delas rodar', async ({ page }) => {
  const oficina = await criarOficina('automacao', 'AUT1A23');

  // um agendamento para amanhã: é o que o lembrete vai encontrar
  const amanha = new Date(Date.now() + 26 * 60 * 60 * 1000);
  await api('/appointments', {
    token: oficina.token,
    payload: {
      customerId: oficina.clienteId,
      vehicleId: oficina.veiculoId,
      title: 'Revisão dos 20.000 km',
      startsAt: amanha.toISOString(),
      endsAt: new Date(amanha.getTime() + 3_600_000).toISOString(),
    },
  });

  await entrarNoPainel(page, oficina.email);
  await page.goto('/configuracoes/automacoes');
  await expect(page.getByRole('heading', { name: 'O que o sistema faz sozinho' })).toBeVisible();

  await test.step('a tela diz o que cada automação faz, e o que ela NÃO faz', async () => {
    const tela = await textoDe(page.locator('main'));
    expect(tela).toContain('Fila de pós-venda');
    expect(tela).toContain('Lembrete de agendamento');
    expect(tela).toContain('Orçamento sem resposta');
    expect(tela, 'a promessa é clara: quem envia é a pessoa').toContain('quem envia é você');
    await captura(page, 'automacoes-01-lista');

    const auditoria = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(auditoria.violations.map((v) => `${v.id}: ${v.nodes.length}`), 'acessibilidade').toEqual([]);
  });

  await test.step('rodar agora mostra o efeito na hora, e o sino recebe o aviso', async () => {
    await page
      .getByRole('listitem')
      .filter({ hasText: 'Lembrete de agendamento' })
      .getByRole('button', { name: 'Rodar agora' })
      .click();
    await expect(page.getByText(/Lembrete de agendamento: \d+ it/)).toBeVisible();
    await expect(page.getByText(/Última vez:/).first()).toBeVisible();
    await captura(page, 'automacoes-02-rodou');

    await page.getByRole('button', { name: 'Avisos' }).click();
    await expect(page.getByText(/agendamento.*amanhã sem confirmar/)).toBeVisible();
    await captura(page, 'automacoes-03-sino');
    await page.keyboard.press('Escape');
  });

  await test.step('desligar uma automação fica salvo', async () => {
    const linha = page.getByRole('listitem').filter({ hasText: 'Fila de pós-venda' });
    await linha.getByRole('checkbox').uncheck();
    await expect(page.getByText('Fila de pós-venda: desligada.')).toBeVisible();

    await page.reload();
    await expect(
      page.getByRole('listitem').filter({ hasText: 'Fila de pós-venda' }).getByRole('checkbox'),
    ).not.toBeChecked();
  });
});
