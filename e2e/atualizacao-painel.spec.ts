import { entrarNoPainel, expect, oficinaComMovimento, test } from './helpers';

/**
 * O painel não pode mostrar número velho. Gravar em qualquer lugar do sistema
 * muda algum indicador — cancelar uma OS tira o carro do pátio e o orçamento da
 * fila —, e o Início precisa refletir isso assim que a pessoa volta para ele.
 */
test('cancelar uma OS atualiza o painel na volta', async ({ page }) => {
  const oficina = await oficinaComMovimento();
  await entrarNoPainel(page, oficina.email);

  // o segundo carro está na oficina, com orçamento esperando resposta
  const naOficina = page.getByRole('link', { name: /Veículos na oficina/ });
  await expect(naOficina).toContainText('1');
  await expect(page.getByRole('link', { name: /Aguardando aprovação/ })).toContainText('1');

  // cancela a OS que estava aguardando aprovação
  await page.getByText('Orçamentos aguardando resposta').waitFor();
  await page.getByRole('link', { name: /OS \d+ · Volkswagen Gol/ }).first().click();
  await expect(page).toHaveURL(/\/ordens\/\d+$/);
  await page.getByRole('button', { name: 'Cancelar OS', exact: true }).click();
  const dialogo = page.getByRole('dialog');
  await dialogo.getByLabel('Motivo do cancelamento').fill('Cliente desistiu do serviço');
  await dialogo.getByRole('button', { name: 'Cancelar OS', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // de volta ao Início: o carro saiu do pátio e o orçamento saiu da fila
  await page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Início' }).click();
  await expect(page.getByRole('heading', { name: /^Olá,/ })).toBeVisible();
  await expect(naOficina, 'o carro cancelado não conta mais no pátio').toContainText('0');
  await expect(page.getByRole('link', { name: /Aguardando aprovação/ })).toContainText('0');
  await expect(page.getByText('Orçamentos aguardando resposta')).toBeHidden();
});
