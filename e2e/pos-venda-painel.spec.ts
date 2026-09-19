import { api, captura, criarOficina, entrarNoPainel, expect, test, textoDe } from './helpers';

/**
 * Pós-venda, avaliação e funil (E16). O roteiro é o dia do atendente: pedir a
 * avaliação de quem levou o carro, anotar no funil quem ligou pedindo preço, e
 * mover esse contato até virar cliente.
 */
test('a oficina pede avaliação, anota o contato no funil e fecha o negócio', async ({ page }) => {
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

  await test.step('o convite de avaliação só aparece com o carro entregue', async () => {
    await page.goto(`/ordens/${ordem.number}`);
    await expect(page.getByRole('button', { name: 'Pedir avaliação' })).toBeVisible();
    await captura(page, 'posvenda-01-pedir-avaliacao');
  });

  await test.step('o cliente avalia pelo link, e a nota aparece no painel', async () => {
    // o link sai pela API, como sairia pelo botão (que abre o WhatsApp)
    const convite = await api<{ publicUrl: string }>(`/work-orders/${ordem.id}/review-invite`, {
      token: oficina.token,
      payload: {},
    });
    const token = convite.publicUrl.slice(convite.publicUrl.lastIndexOf('/') + 1);

    const celular = await page.context().newPage();
    await celular.setViewportSize({ width: 390, height: 844 });
    await celular.goto(`/avaliacao/${token}`);
    await expect(celular.getByRole('heading', { name: 'Como foi o atendimento?' })).toBeVisible();
    await celular.getByRole('button', { name: /5 estrelas/ }).click();
    await celular.getByLabel(/Quer contar alguma coisa/).fill('Rápido e bem feito.');
    await celular.screenshot({ path: 'e2e/screenshots/posvenda-02-avaliacao-celular.png', fullPage: true });
    await celular.getByRole('button', { name: 'Enviar avaliação' }).click();
    await expect(celular.getByRole('heading', { name: 'Obrigado pela avaliação!' })).toBeVisible();
    await celular.close();

    await page.goto('/avaliacoes');
    await expect(page.getByRole('heading', { name: 'Avaliações', exact: true })).toBeVisible();
    const tela = await textoDe(page.locator('main'));
    expect(tela, 'a média apareceu').toContain('5,0');
    expect(tela, 'o comentário aparece como o cliente escreveu').toContain('Rápido e bem feito.');
    await captura(page, 'posvenda-03-avaliacoes');
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
