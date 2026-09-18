import AxeBuilder from '@axe-core/playwright';
import { abrirOS, api, captura, criarOficina, entrarNoPainel, enviarOrcamento, expect, test, textoDe } from './helpers';

/**
 * O financeiro (E13). O que este roteiro prova na tela, e não só na API:
 * a OS finalizada aparece em "A receber" pelo valor aprovado, a baixa feita
 * aqui cai no caixa da OS, a despesa lançada à mão vira conta a pagar e o
 * fluxo de caixa fecha com as duas pontas.
 */
test('a oficina recebe pela tela do financeiro, lança a despesa do mês e vê o caixa fechar', async ({ page }) => {
  const oficina = await criarOficina('financeiro', 'FIN2B34');
  const ordem = await abrirOS(oficina);
  const orcamento = await enviarOrcamento(oficina, ordem.id);
  // aprovado por telefone: só o serviço é necessário, a peça é recomendada
  await api(`/quotes/${orcamento.id}/manual-decision`, {
    token: oficina.token,
    payload: { decision: 'APPROVED', channel: 'PHONE', signerName: 'João Pereira' },
  });
  await api(`/work-orders/${ordem.id}/start`, { token: oficina.token, payload: {} });
  await api(`/work-orders/${ordem.id}/complete`, { token: oficina.token, payload: {} });

  await entrarNoPainel(page, oficina.email);

  await test.step('a OS finalizada já está em "A receber", pelo valor aprovado', async () => {
    await page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'A receber' }).click();
    await expect(page.getByRole('heading', { name: 'Contas a receber' })).toBeVisible();
    const tela = await textoDe(page.locator('main'));
    expect(tela, 'a conta nasceu da OS').toContain(`OS nº ${ordem.number}`);
    expect(tela, 'R$ 180 do serviço + 2 × R$ 250 da peça aprovada').toContain('R$ 680,00');
    await captura(page, 'financeiro-01-a-receber');
  });

  await test.step('a baixa feita aqui é o pagamento do caixa da OS', async () => {
    await page.getByRole('button', { name: new RegExp(`OS nº ${ordem.number}`) }).click();
    const ficha = page.getByRole('dialog');
    await expect(ficha.getByText(/Esta conta espelha a OS/)).toBeVisible();
    await captura(page, 'financeiro-02-ficha');

    await ficha.getByRole('button', { name: 'Registrar recebimento', exact: true }).click();
    await expect(ficha.getByRole('heading', { name: 'Registrar recebimento', exact: true })).toBeVisible();
    await expect(ficha.getByLabel('Valor', { exact: true })).toHaveValue('680,00');
    await ficha.getByLabel('Valor', { exact: true }).fill('300,00');
    await ficha.getByLabel('Forma', { exact: true }).selectOption('PIX');
    await ficha.getByRole('button', { name: 'Registrar', exact: true }).click();

    await expect(ficha.getByText('Parcial', { exact: true }).first()).toBeVisible();
    const detalhe = await textoDe(ficha);
    expect(detalhe, 'recebido').toContain('R$ 300,00');
    expect(detalhe, 'falta').toContain('R$ 380,00');
    expect(detalhe, 'a baixa veio do caixa da OS').toContain('pelo caixa da OS');
    await page.keyboard.press('Escape');
  });

  await test.step('e a OS mostra o mesmo dinheiro, sem lançamento paralelo', async () => {
    await page.goto(`/ordens/${ordem.number}`);
    await expect(page.getByRole('heading', { name: new RegExp(`^OS ${ordem.number}`) })).toBeVisible();
    const cartao = await textoDe(page.locator('main'));
    expect(cartao, 'recebido na OS').toContain('R$ 300,00');
    expect(cartao, 'falta na OS').toContain('R$ 380,00');
  });

  await test.step('a despesa do mês vira conta a pagar', async () => {
    await page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'A pagar' }).click();
    await expect(page.getByRole('heading', { name: 'Contas a pagar' })).toBeVisible();
    // a lista vazia repete o botão no estado vazio: o do cabeçalho é o primeiro
    await page.getByRole('button', { name: 'Nova conta a pagar' }).first().click();

    const dialogo = page.getByRole('dialog');
    await dialogo.getByLabel('Descrição', { exact: true }).fill('Aluguel do galpão');
    await dialogo.getByLabel('Categoria', { exact: true }).selectOption({ label: 'Aluguel' });
    await dialogo.getByLabel('Valor', { exact: true }).fill('1.200,00');
    await captura(page, 'financeiro-03-nova-despesa');
    await dialogo.getByRole('button', { name: 'Lançar', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await expect(page.getByText('Aluguel do galpão')).toBeVisible();
    const lista = await textoDe(page.locator('main'));
    expect(lista).toContain('R$ 1.200,00');

    // e a baixa dela sai daqui mesmo
    await page.getByRole('button', { name: /Aluguel do galpão/ }).click();
    const ficha = page.getByRole('dialog');
    await ficha.getByRole('button', { name: 'Registrar pagamento', exact: true }).click();
    await ficha.getByLabel('Forma', { exact: true }).selectOption('BANK_TRANSFER');
    await ficha.getByRole('button', { name: 'Registrar', exact: true }).click();
    await expect(ficha.getByText('Quitada', { exact: true }).first()).toBeVisible();
    await page.keyboard.press('Escape');
  });

  await test.step('o fluxo de caixa mostra as duas pontas e o lucro estimado', async () => {
    await page.getByRole('link', { name: 'Fluxo de caixa' }).first().click();
    await expect(page.getByRole('heading', { name: 'Fluxo de caixa' })).toBeVisible();
    const tela = await textoDe(page.locator('main'));
    expect(tela, 'entrou o recebimento da OS').toContain('R$ 300,00');
    expect(tela, 'saiu o aluguel').toContain('R$ 1.200,00');
    expect(tela).toContain('Lucro estimado');
    await captura(page, 'financeiro-04-caixa');

    const auditoria = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(auditoria.violations.map((v) => `${v.id}: ${v.nodes.length}`), 'acessibilidade').toEqual([]);
  });
});
