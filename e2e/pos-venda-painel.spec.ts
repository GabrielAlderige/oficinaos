import { api, captura, criarOficina, entrarNoPainel, expect, test } from './helpers';

/**
 * Pós-venda, avaliação e funil (E16). O roteiro é o dia do atendente: pedir a
 * avaliação de quem levou o carro, anotar no funil quem ligou pedindo preço, e
 * mover esse contato até virar cliente.
 */
test('a oficina pede avaliação, anota o contato no funil e fecha o negócio', async ({ page, ignorarErros }) => {
  // o convite sem link do Google cadastrado responde 422 de propósito
  ignorarErros.push(/status of 422/);
  const oficina = await criarOficina('posvenda', 'PVE9Y87');
  const ordem = await api<{ id: string; number: number }>('/work-orders', {
    token: oficina.token,
    payload: {
      customerId: oficina.clienteId,
      vehicleId: oficina.veiculoId,
      items: [{ type: 'SERVICE', serviceId: oficina.servicoId }],
    },
  });
  const orcamento = await api<{ id: string }>(`/work-orders/${ordem.id}/quotes`, { token: oficina.token, payload: {} });
  await api(`/quotes/${orcamento.id}/manual-decision`, {
    token: oficina.token,
    payload: { decision: 'APPROVED', channel: 'PHONE' },
  });
  await api(`/work-orders/${ordem.id}/start`, { token: oficina.token, payload: {} });
  await api(`/work-orders/${ordem.id}/complete`, { token: oficina.token, payload: {} });
  await api(`/work-orders/${ordem.id}/payments`, {
    token: oficina.token,
    payload: { method: 'PIX', amountCents: 18_000 },
  });
  await api(`/work-orders/${ordem.id}/deliver`, { token: oficina.token, payload: {} });

  await entrarNoPainel(page, oficina.email);

  await test.step('o convite de avaliação leva ao Google da oficina', async () => {
    await page.goto(`/ordens/${ordem.number}`);
    await expect(page.getByRole('button', { name: 'Pedir avaliação' })).toBeVisible();
    await captura(page, 'posvenda-01-pedir-avaliacao');

    // sem o link cadastrado, o botão avisa onde configurar em vez de mandar
    // o cliente para lugar nenhum
    await page.getByRole('button', { name: 'Pedir avaliação' }).click();
    await expect(page.getByText(/link de avaliação do Google/i)).toBeVisible();

    await api('/organization/settings', {
      token: oficina.token,
      method: 'PATCH',
      payload: { googleReviewUrl: 'https://g.page/r/oficina-de-teste' },
    });

    const [aba] = await Promise.all([
      page.context().waitForEvent('page'),
      page.getByRole('button', { name: 'Pedir avaliação' }).click(),
    ]);
    const link = decodeURIComponent(aba.url().replace(/\+/g, ' '));
    expect(link, 'o convite carrega o link do Google').toContain('g.page/r/oficina-de-teste');
    await aba.close();
    await captura(page, 'posvenda-02-convite-google');
  });

  await test.step('o contato entra no funil, anda de etapa e vira cliente', async () => {
    await page.goto('/funil');
    await page.getByRole('button', { name: 'Novo contato' }).first().click();
    const dialogo = page.getByRole('dialog');
    await dialogo.getByLabel('Nome', { exact: true }).fill('Carlos Lima');
    await dialogo.getByLabel('WhatsApp', { exact: true }).fill('(11) 98888-7777');
    await dialogo.getByLabel('Carro', { exact: true }).fill('Corolla 2018');
    await dialogo.getByLabel('Valor estimado', { exact: true }).fill('1.200,00');
    await dialogo.getByRole('button', { name: 'Adicionar', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText('Carlos Lima')).toBeVisible();
    await captura(page, 'posvenda-04-funil');

    // anda até "Fechado" e vira cliente
    for (const etapa of ['Em conversa', 'Orçamento enviado', 'Aguardando decisão', 'Fechado']) {
      await page.getByRole('button', { name: etapa, exact: true }).first().click();
      await expect(page.getByRole('button', { name: etapa, exact: true })).toHaveCount(0);
    }
    await page.getByRole('button', { name: 'Virar cliente' }).click();
    await expect(page.getByRole('link', { name: 'ver cliente' })).toBeVisible();

    await page.goto('/clientes?q=Carlos');
    await expect(page.getByText('Carlos Lima')).toBeVisible();
  });
});
