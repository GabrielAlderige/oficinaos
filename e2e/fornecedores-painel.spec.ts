import { captura, criarOficina, entrarNoPainel, expect, test } from './helpers';

/**
 * Fornecedores (E10). O caminho de quem monta a base de compras: cadastra o
 * fornecedor com as categorias que ele atende, liga uma peça a ele, acha pelo
 * filtro de categoria e, um dia, tira da lista sem quebrar a peça.
 */
test('cadastra o fornecedor, liga a peça e tira da lista sem quebrar nada', async ({ page }) => {
  const oficina = await criarOficina('fornec', 'FOR1A23');
  await entrarNoPainel(page, oficina.email);

  await page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Fornecedores' }).click();
  await expect(page.getByRole('heading', { name: 'Fornecedores', exact: true })).toBeVisible();
  await expect(page.getByText('Nenhum fornecedor ainda')).toBeVisible();
  await captura(page, 'fornecedores-01-vazio');

  // cadastro: nome, WhatsApp, categorias (sugerida e digitada), prazo e nota
  await page.getByRole('button', { name: 'Novo fornecedor' }).click();
  const dialogo = page.getByRole('dialog', { name: 'Novo fornecedor' });
  await dialogo.getByLabel('Nome', { exact: true }).fill('Central Autopeças');
  await dialogo.getByLabel('Vendedor').fill('Roberto');
  await dialogo.getByLabel('WhatsApp').fill('(11) 98888-7777');
  await dialogo.getByRole('button', { name: 'Freios', exact: true }).click();
  await dialogo.locator('#s-categories').fill('Borracharia');
  await dialogo.locator('#s-categories').press('Enter');
  await dialogo.getByLabel('Prazo médio de entrega').fill('2');
  await dialogo.getByRole('radio', { name: '4 de 5' }).click();
  await captura(page, 'fornecedores-02-cadastro');
  await dialogo.getByRole('button', { name: 'Cadastrar fornecedor' }).click();

  // cai na ficha, com o que foi cadastrado
  await expect(page.getByRole('heading', { name: 'Central Autopeças', level: 1 })).toBeVisible();
  await expect(page.getByText('2 dias')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Borracharia' })).toBeVisible();
  await expect(page.getByText('Nenhuma peça tem este fornecedor como preferido ainda')).toBeVisible();
  const ficha = page.url();

  // liga a peça ao fornecedor pela edição da peça
  await page.goto('/pecas');
  await page.getByRole('link', { name: /Pastilha de freio/ }).first().click();
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  const edicao = page.getByRole('dialog');
  await edicao.getByLabel('Fornecedor preferido').selectOption({ label: 'Central Autopeças' });
  await edicao.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Central Autopeças' })).toBeVisible();

  // a ficha do fornecedor passa a mostrar a peça
  await page.goto(ficha);
  await expect(page.getByText('Preferido em 1 peça')).toBeVisible();
  await expect(page.getByRole('link', { name: /Pastilha de freio/ })).toBeVisible();
  await captura(page, 'fornecedores-03-ficha');

  // a lista acha pelo filtro de categoria
  await page.goto('/fornecedores');
  await page.getByRole('group', { name: 'Filtrar por categoria' }).getByRole('button', { name: 'Freios' }).click();
  await expect(page.getByRole('link', { name: /Central Autopeças/ })).toBeVisible();
  await page.getByRole('group', { name: 'Filtrar por categoria' }).getByRole('button', { name: 'Motor' }).click();
  await expect(page.getByText('Ninguém cadastrado atende “Motor”.')).toBeVisible();
  await captura(page, 'fornecedores-04-filtro');

  // categoria que não é de peça, vinda do link da ficha: aparece marcada e dá para tirar
  await page.goto(ficha);
  await page.getByRole('link', { name: 'Borracharia' }).click();
  const filtros = page.getByRole('group', { name: 'Filtrar por categoria' });
  await expect(filtros.getByRole('button', { name: 'Borracharia', pressed: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /Central Autopeças/ })).toBeVisible();
  await filtros.getByRole('button', { name: 'Borracharia' }).click();
  await expect(page).not.toHaveURL(/categoria=/);

  // tirar da lista: some, e a peça fica sem preferido em vez de apontar para o nada
  await page.goto(ficha);
  await page.getByRole('button', { name: 'Tirar fornecedor da lista' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Tirar da lista' }).click();
  await expect(page).toHaveURL(/\/fornecedores$/);
  await expect(page.getByText('Nenhum fornecedor ainda')).toBeVisible();

  await page.goto('/pecas');
  await page.getByRole('link', { name: /Pastilha de freio/ }).first().click();
  await expect(page.getByRole('link', { name: 'Central Autopeças' })).toHaveCount(0);
});
