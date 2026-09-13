import {
  abrirOS,
  api,
  captura,
  criarOficina,
  entrarNoPainel,
  enviarOrcamento,
  expect,
  test,
  textoDe,
} from './helpers';

/**
 * O fim do ciclo: finalizar, avisar o cliente e entregar. A entrega com saldo
 * em aberto é permitida (o fiado existe), mas não pode acontecer por distração.
 */
test('finalizar, avisar que está pronto e entregar devendo pede confirmação', async ({ page }) => {
  const oficina = await criarOficina('entrega', 'ENT1A23');
  const ordem = await abrirOS(oficina);
  const orcamento = await enviarOrcamento(oficina, ordem.id);

  await api(`/quotes/${orcamento.id}/manual-decision`, {
    token: oficina.token,
    payload: { decision: 'APPROVED', channel: 'PHONE', signerName: 'João Pereira' },
  });

  await entrarNoPainel(page, oficina.email);
  await page.goto(`/ordens/${ordem.number}`);
  await expect(page.getByRole('heading', { name: new RegExp(`^OS ${ordem.number}`) })).toBeVisible();

  await test.step('executar e finalizar', async () => {
    await page.getByRole('button', { name: 'Iniciar execução', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Finalizar serviço', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Finalizar serviço', exact: true }).click();

    // a peça sai do estoque na finalização: 4 em estoque, 2 na OS
    await expect(page.getByText(/dispon[ií]vel: 2/)).toBeVisible();
    await captura(page, 'entrega-01-finalizada');
  });

  await test.step('o botão de avisar o cliente aparece com a OS finalizada', async () => {
    await expect(page.getByRole('button', { name: 'Avisar que está pronto', exact: true })).toBeVisible();
    await captura(page, 'entrega-02-avisar');
  });

  await test.step('entregar devendo pede confirmação e mostra o saldo', async () => {
    await page.getByRole('button', { name: 'Entregar veículo', exact: true }).click();

    const dialogo = page.getByRole('dialog');
    await expect(dialogo.getByRole('heading', { name: 'Entregar com saldo em aberto?', exact: true })).toBeVisible();
    const aviso = await textoDe(dialogo);
    expect(aviso, 'a pessoa vê quanto falta antes de confirmar').toContain('R$ 680,00');
    await captura(page, 'entrega-03-confirmar');

    await dialogo.getByRole('button', { name: 'Entregar mesmo assim', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    const ficha = await textoDe(page.locator('main'));
    expect(ficha).toContain('Entregue');
    await captura(page, 'entrega-04-entregue');
  });
});
