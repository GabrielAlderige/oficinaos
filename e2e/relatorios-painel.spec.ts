import AxeBuilder from '@axe-core/playwright';
import { api, captura, criarOficina, entrarNoPainel, expect, test, textoDe } from './helpers';

/**
 * Relatórios e produtividade (E15). Prova na tela o que a API já garante: o
 * cronômetro do serviço vira tempo real no relatório de mecânicos, e o CSV que
 * o contador pede sai com um clique.
 *
 * O relatório não é mais uma tela: é um botão no topo que abre por cima, de
 * qualquer lugar do sistema. O roteiro segue por aí.
 */
test('a oficina cronometra o serviço, lê os relatórios e baixa a planilha', async ({ page }) => {
  const oficina = await criarOficina('relatorios', 'REL9Z98');
  // o relatório de mecânicos usa o responsável da OS quando o item não tem um
  const eu = await api<{ user: { id: string; name: string } }>('/auth/me', { token: oficina.token });
  const ordem = await api<{ id: string; number: number }>('/work-orders', {
    token: oficina.token,
    payload: {
      customerId: oficina.clienteId,
      vehicleId: oficina.veiculoId,
      complaint: 'Barulho ao frear',
      mechanicUserId: eu.user.id,
      items: [
        { type: 'SERVICE', serviceId: oficina.servicoId },
        { type: 'PART', partId: oficina.pecaId, quantity: 2 },
      ],
    },
  });
  const orcamento = await api<{ id: string }>(`/work-orders/${ordem.id}/quotes`, { token: oficina.token, payload: {} });
  await api(`/quotes/${orcamento.id}/manual-decision`, {
    token: oficina.token,
    payload: { decision: 'APPROVED', channel: 'PHONE' },
  });
  await api(`/work-orders/${ordem.id}/start`, { token: oficina.token, payload: {} });

  await entrarNoPainel(page, oficina.email);

  await test.step('o cronômetro do serviço começa e para na própria linha do item', async () => {
    await page.goto(`/ordens/${ordem.number}`);
    await expect(page.getByRole('heading', { name: new RegExp(`^OS ${ordem.number}`) })).toBeVisible();

    await page.getByRole('button', { name: /Iniciar o cronômetro/ }).click();
    await expect(page.getByRole('button', { name: /Parar o cronômetro/ })).toBeVisible();
    await expect(page.getByText(/correndo/)).toBeVisible();
    await captura(page, 'relatorios-01-cronometro');

    await page.getByRole('button', { name: /Parar o cronômetro/ }).click();
    await expect(page.getByRole('button', { name: /Iniciar o cronômetro/ })).toBeVisible();
    // 1 minuto é o mínimo: serviço de 40 segundos não vira zero
    await expect(page.getByText(/1 min/).first()).toBeVisible();
  });

  await test.step('o relatório abre por cima, sem sair de onde a pessoa estava', async () => {
    await api(`/work-orders/${ordem.id}/complete`, { token: oficina.token, payload: {} });
    // de propósito a partir da tela da OS: o popup existe para não tirar
    // ninguém do lugar
    await page.goto(`/ordens/${ordem.number}`);
    await page.getByRole('button', { name: 'Relatórios' }).click();

    const popup = page.getByRole('dialog', { name: 'Relatórios' });
    await expect(popup).toBeVisible();
    await popup.getByRole('button', { name: 'Mecânicos' }).click();
    // a tabela chega depois do cabeçalho: ler antes disso pega o esqueleto
    await expect(popup.getByText(eu.user.name).first()).toBeVisible();
    const comMecanicos = await textoDe(popup);
    expect(comMecanicos, 'o responsável da OS aparece').toContain(eu.user.name);
    expect(comMecanicos, 'o tempo veio do cronômetro').toContain('1 min');
    await captura(page, 'relatorios-02-popup-mecanicos');

    const auditoria = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(auditoria.violations.map((v) => `${v.id}: ${v.nodes.length}`), 'acessibilidade').toEqual([]);
  });

  await test.step('o faturamento fecha com a OS, e o CSV baixa do popup', async () => {
    const popup = page.getByRole('dialog', { name: 'Relatórios' });
    await popup.getByRole('button', { name: 'Faturamento' }).click();
    await expect(popup.getByText('R$ 680,00').first()).toBeVisible();
    expect(await textoDe(popup), 'R$ 180 de serviço + 2 × R$ 250 de peça').toContain('R$ 680,00');
    await captura(page, 'relatorios-03-popup-faturamento');

    const baixando = page.waitForEvent('download');
    await popup.getByRole('button', { name: 'CSV', exact: true }).click();
    const arquivo = await baixando;
    expect(arquivo.suggestedFilename()).toMatch(/^faturamento-\d{4}-\d{2}-\d{2}-a-\d{4}-\d{2}-\d{2}\.csv$/);

    // fechar devolve a pessoa para a OS, que continua aberta atrás
    await page.keyboard.press('Escape');
    await expect(popup).toBeHidden();
    await expect(page.getByRole('heading', { name: new RegExp(`^OS ${ordem.number}`) })).toBeVisible();
  });
});
