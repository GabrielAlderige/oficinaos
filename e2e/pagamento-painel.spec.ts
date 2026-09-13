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
 * O caixa da oficina: receber em partes, fechar a conta e desfazer um
 * lançamento errado. O nome do arquivo termina em `painel.spec.ts` de
 * propósito — é o que o projeto "painel" do playwright.config casa.
 */
test('a oficina recebe em partes, fecha a conta e cancela um lançamento errado', async ({ page }) => {
  const oficina = await criarOficina('caixa', 'PAG1A23');
  const ordem = await abrirOS(oficina);
  const orcamento = await enviarOrcamento(oficina, ordem.id);

  // o cliente aprovou por telefone: a OS deve R$ 680,00
  await api(`/quotes/${orcamento.id}/manual-decision`, {
    token: oficina.token,
    payload: { decision: 'APPROVED', channel: 'PHONE', signerName: 'João Pereira' },
  });

  await entrarNoPainel(page, oficina.email);
  await page.goto(`/ordens/${ordem.number}`);
  await expect(page.getByRole('heading', { name: new RegExp(`^OS ${ordem.number}`) })).toBeVisible();

  await test.step('o cartão mostra o que falta receber', async () => {
    const cartao = await textoDe(page.locator('main'));
    expect(cartao).toContain('Pagamento');
    expect(cartao, 'nada recebido ainda').toContain('R$ 680,00');
    await captura(page, 'pagamento-01-em-aberto');
  });

  await test.step('receber uma parte deixa a OS em Parcial', async () => {
    await page.getByRole('button', { name: 'Registrar pagamento', exact: true }).click();
    const dialogo = page.getByRole('dialog');
    await expect(dialogo.getByRole('heading', { name: 'Registrar pagamento', exact: true })).toBeVisible();

    // o campo já vem com o saldo inteiro: no balcão, receber o resto é o comum
    await expect(dialogo.getByLabel('Valor', { exact: true })).toHaveValue('680,00');
    await dialogo.getByLabel('Valor', { exact: true }).fill('100,00');
    await dialogo.getByLabel('Forma', { exact: true }).selectOption('PIX');
    await captura(page, 'pagamento-02-registrar');

    await dialogo.getByRole('button', { name: 'Registrar', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    const cartao = await textoDe(page.locator('main'));
    expect(cartao).toContain('Parcial');
    expect(cartao, 'recebido').toContain('R$ 100,00');
    expect(cartao, 'falta o restante').toContain('R$ 580,00');
    await captura(page, 'pagamento-03-parcial');
  });

  await test.step('receber o restante fecha a conta', async () => {
    await page.getByRole('button', { name: 'Registrar pagamento', exact: true }).click();
    const dialogo = page.getByRole('dialog');
    await expect(dialogo.getByLabel('Valor', { exact: true })).toHaveValue('580,00');
    await dialogo.getByLabel('Forma', { exact: true }).selectOption('CASH');
    await dialogo.getByRole('button', { name: 'Registrar', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    const cartao = await textoDe(page.locator('main'));
    expect(cartao).toContain('Pago');
    expect(cartao, 'não falta nada').toContain('R$ 0,00');
    // com a conta fechada, não se oferece registrar de novo
    await expect(page.getByRole('button', { name: 'Registrar pagamento', exact: true })).toHaveCount(0);
    await captura(page, 'pagamento-04-pago');
  });

  await test.step('cancelar o lançamento errado reabre o saldo, sem apagar o histórico', async () => {
    await page.getByRole('button', { name: 'Cancelar lançamento', exact: true }).first().click();
    const dialogo = page.getByRole('dialog');
    await expect(dialogo.getByRole('heading', { name: 'Cancelar o lançamento?', exact: true })).toBeVisible();
    await dialogo.getByLabel('Motivo', { exact: true }).fill('Lançado em duplicidade');
    await dialogo.getByRole('button', { name: 'Cancelar lançamento', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    const cartao = await textoDe(page.locator('main'));
    expect(cartao, 'o saldo volta a ficar em aberto').toContain('Parcial');
    expect(cartao, 'o lançamento continua na lista, marcado').toContain('Lançado em duplicidade');
    await captura(page, 'pagamento-05-cancelado');
  });
});
