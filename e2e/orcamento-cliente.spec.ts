import {
  abrirOS,
  api,
  captura,
  criarOficina,
  enviarOrcamento,
  expect,
  test,
  textoDe,
  type OrdemCompleta,
} from './helpers';

/**
 * O caminho do CLIENTE — o fluxo que o produto inteiro existe para servir:
 * link no celular → aprova → a OS muda sozinha e o estoque é reservado.
 */
test('o cliente aprova o orçamento pelo celular e a OS fica aprovada', async ({ page }) => {
  const oficina = await criarOficina('cliente', 'ABC1C34');
  const ordem = await abrirOS(oficina);
  const orcamento = await enviarOrcamento(oficina, ordem.id);

  await test.step('o link abre sem login, com necessários e recomendados separados', async () => {
    await page.goto(orcamento.publicUrl);
    await expect(page.getByRole('heading', { name: 'Orçamento para seu veículo', exact: true })).toBeVisible();

    const corpo = await textoDe(page.locator('body'));
    for (const esperado of ['Olá, João', 'Volkswagen Gol', 'ABC1C34', 'Necessários', 'Recomendados', 'R$ 680,00']) {
      expect(corpo, `a página do cliente deveria mostrar “${esperado}”`).toContain(esperado);
    }
    await captura(page, 'cliente-01-orcamento');
  });

  await test.step('nada da oficina vaza para a página do cliente', async () => {
    const corpo = await textoDe(page.locator('body'));
    for (const proibido of ['Custo', 'custo médio', 'margem', 'CPF']) {
      expect(corpo, `a página do cliente não pode mostrar “${proibido}”`).not.toContain(proibido);
    }
  });

  await test.step('desmarcar o recomendado tira R$ 500,00 do total, na hora', async () => {
    await page.getByRole('checkbox').first().uncheck();
    await expect(page.getByText('R$ 180,00', { exact: true }).first()).toBeVisible();
    await page.getByRole('checkbox').first().check();
  });

  await test.step('aprovar exige nome E aceite explícito (nada pré-marcado)', async () => {
    await page.getByRole('button', { name: 'Aprovar orçamento', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Confirmar aprovação', exact: true })).toBeVisible();

    const folha = await textoDe(page.locator('body'));
    expect(folha).toContain('aprovando 2 itens');
    expect(folha).toContain('R$ 680,00');
    await captura(page, 'cliente-02-confirmacao');

    const confirmar = page.getByRole('button', { name: 'Confirmar aprovação', exact: true });
    await expect(confirmar).toBeDisabled();
    await page.getByLabel('Seu nome', { exact: true }).fill('João Pereira');
    await expect(confirmar, 'só o nome não basta: falta o aceite').toBeDisabled();
    await page.getByRole('checkbox').last().check();
    await expect(confirmar).toBeEnabled();

    await confirmar.click();
    await expect(page.getByText('Orçamento aprovado. Obrigado!', { exact: true })).toBeVisible();
    await captura(page, 'cliente-03-aprovado');
  });

  await test.step('recarregar mostra o resultado, sem oferecer aprovar de novo', async () => {
    await page.reload();
    await expect(page.getByText('Orçamento aprovado. Obrigado!', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Aprovar orçamento', exact: true })).toHaveCount(0);
  });

  await test.step('na oficina: OS aprovada e 2 pastilhas reservadas', async () => {
    const os = await api<OrdemCompleta>(`/work-orders/${ordem.number}`, { token: oficina.token });
    expect(os.status).toBe('APPROVED');

    const peca = os.items.find((item) => item.type === 'PART');
    expect(peca?.stockStatus).toBe('RESERVED');
    expect(Number(peca?.reservedQuantity)).toBe(2);

    const ficha = await api<{ quantityReserved: number; quantityAvailable: number }>(`/parts/${oficina.pecaId}`, {
      token: oficina.token,
    });
    expect(ficha.quantityReserved).toBe(2);
    expect(ficha.quantityAvailable, '4 em estoque, 2 reservadas').toBe(2);
  });

  await test.step('a timeline registra envio, visualização e aprovação', async () => {
    const timeline = await api<{ data: { type: string }[] }>(`/work-orders/${ordem.id}/timeline`, {
      token: oficina.token,
    });
    const tipos = timeline.data.map((evento) => evento.type);
    expect(tipos).toEqual(expect.arrayContaining(['QUOTE_SENT', 'QUOTE_VIEWED', 'QUOTE_APPROVED']));
  });
});
