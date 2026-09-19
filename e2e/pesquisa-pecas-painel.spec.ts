import { abrirOS, api, captura, criarOficina, entrarNoPainel, expect, test, textoDe } from './helpers';

/**
 * Pesquisa de peças e comparador (E14). O roteiro segue o que a oficina faz:
 * chega a planilha do fornecedor, ela é importada no cadastro dele, e a busca
 * passa a comparar aquele preço com o que já está na prateleira — até escolher
 * uma oferta e jogá-la na OS.
 */
test('a oficina importa a lista do fornecedor, compara com o estoque e joga a peça na OS', async ({ page }) => {
  const oficina = await criarOficina('pesquisa', 'PSQ3C45');
  const ordem = await abrirOS(oficina);
  const fornecedor = await api<{ id: string; name: string }>('/suppliers', {
    token: oficina.token,
    payload: { name: 'Central Autopeças', leadTimeDays: 2 },
  });

  await entrarNoPainel(page, oficina.email);

  await test.step('a planilha do fornecedor entra pelo cadastro dele', async () => {
    await page.goto(`/fornecedores/${fornecedor.id}`);
    await expect(page.getByRole('heading', { name: 'Central Autopeças' })).toBeVisible();
    await page.getByRole('button', { name: 'Importar CSV' }).click();

    const dialogo = page.getByRole('dialog');
    await dialogo.getByLabel('Arquivo CSV').setInputFiles({
      name: 'lista-setembro.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        [
          'Código;Descrição;Marca;Preço;Unidade',
          'CA-PAST;Pastilha de freio dianteira;Fras-le;89,90;PC',
          'CA-DISC;Disco de freio ventilado;Bosch;196,00;PC',
          'CA-ERR;;Sem preço;;PC',
        ].join('\n'),
        'utf-8',
      ),
    });
    await captura(page, 'pesquisa-01-importar');
    await dialogo.getByRole('button', { name: 'Importar', exact: true }).click();

    // o que deu certo e o que não deu, com o número da linha
    await expect(dialogo.getByText(/2 itens novos e 0 atualizados/)).toBeVisible();
    await expect(dialogo.getByText(/linha 4: sem descrição/)).toBeVisible();
    // o X do diálogo também se chama "Fechar": aqui interessa o botão do rodapé
    await dialogo.getByRole('button', { name: 'Fechar', exact: true }).first().click();

    const ficha = await textoDe(page.locator('main'));
    expect(ficha, 'a lista aparece na ficha').toContain('Pastilha de freio dianteira');
    expect(ficha).toContain('R$ 89,90');
  });

  await test.step('a busca compara a prateleira com a lista, e explica cada selo', async () => {
    await page.goto(`/pecas/pesquisa?os=${ordem.number}`);
    await expect(page.getByText(`Adicionando à OS nº ${ordem.number}`)).toBeVisible();
    await page.getByLabel('O que você procura').fill('pastilha');
    await page.getByRole('button', { name: 'Pesquisar' }).click();

    await expect(page.getByText(/ofertas para "pastilha"/)).toBeVisible();
    const tela = await textoDe(page.locator('main'));
    // o estoque custa R$ 100 (a peça da oficina de teste) e a lista, R$ 89,90
    expect(tela, 'a oferta da lista').toContain('R$ 89,90');
    expect(tela, 'a peça do estoque').toContain('Pronta entrega');
    expect(tela, 'os selos aparecem').toContain('Melhor preço');
    expect(tela, 'a regra do custo-benefício fica escrita').toContain('2% do preço');
    await captura(page, 'pesquisa-02-comparador');
  });

  await test.step('a oferta escolhida vira item da OS, pelo preço com a margem', async () => {
    await page.getByRole('button', { name: 'Adicionar à OS' }).first().click();
    const dialogo = page.getByRole('dialog');
    await expect(dialogo.getByRole('heading', { name: 'Adicionar à OS' })).toBeVisible();
    await dialogo.getByLabel('Quantidade', { exact: true }).fill('2');
    await captura(page, 'pesquisa-03-adicionar');
    await dialogo.getByRole('button', { name: 'Adicionar', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.goto(`/ordens/${ordem.number}`);
    await expect(page.getByRole('heading', { name: new RegExp(`^OS ${ordem.number}`) })).toBeVisible();
    const os = await textoDe(page.locator('main'));
    expect(os, 'a peça entrou na OS').toContain('Pastilha de freio');
    // R$ 89,90 de custo com 30% de margem = R$ 116,87
    expect(os, 'com o preço sugerido pela margem').toContain('R$ 116,87');
  });
});
