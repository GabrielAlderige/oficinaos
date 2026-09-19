import { api, captura, criarOficina, entrarNoPainel, expect, test, textoDe } from './helpers';

/**
 * Relatórios e produtividade (E15). Prova na tela o que a API já garante: o
 * cronômetro do serviço vira tempo real no relatório de mecânicos, e o CSV que
 * o contador pede sai com um clique.
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

  await test.step('o relatório de mecânicos mostra o tempo medido', async () => {
    await api(`/work-orders/${ordem.id}/complete`, { token: oficina.token, payload: {} });
    await page.goto('/relatorios?r=mechanics');
    await expect(page.getByRole('heading', { name: 'Mecânicos' })).toBeVisible();
    const tela = await textoDe(page.locator('main'));
    expect(tela, 'o responsável da OS aparece').toContain(eu.user.name);
    expect(tela, 'o tempo veio do cronômetro').toContain('1 min');
    await captura(page, 'relatorios-02-mecanicos');
  });

  await test.step('o faturamento fecha com a OS, e o CSV baixa', async () => {
    await page.goto('/relatorios?r=revenue');
    await expect(page.getByRole('heading', { name: 'Faturamento' })).toBeVisible();
    const tela = await textoDe(page.locator('main'));
    expect(tela, 'R$ 180 de serviço + 2 × R$ 250 de peça').toContain('R$ 680,00');
    await captura(page, 'relatorios-03-faturamento');

    const baixando = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Baixar CSV' }).click();
    const arquivo = await baixando;
    expect(arquivo.suggestedFilename()).toMatch(/^faturamento-\d{4}-\d{2}-\d{2}-a-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});
