import { captura, entrarNoPainel, expect, oficinaComMovimento, test } from './helpers';

/**
 * Painel de Início (E9). O que precisa ficar provado na tela: o número que a
 * oficina lidera, o "Atenção necessária" com caminho para resolver, e que os
 * primeiros passos saem da frente quando a oficina já está trabalhando.
 */

test('o painel lidera pelo faturamento e mostra o que está travado', async ({ page }) => {
  const oficina = await oficinaComMovimento();
  await entrarNoPainel(page, oficina.email);

  // o número que a oficina lidera: faturado no período, com a ressalva ao lado
  await expect(page.getByText(/^Faturado —/)).toBeVisible();
  await expect(page.getByText('faturar não é receber')).toBeVisible();

  // e o recebido, que é outra conta: R$ 100,00 dos R$ 680,00
  await expect(page.getByText('Recebido no período')).toBeVisible();

  // o que está travado, com o caminho
  await expect(page.getByText('Orçamentos aguardando resposta')).toBeVisible();
  await expect(page.getByText('Entregues com saldo em aberto')).toBeVisible();
  // a oficina já cadastrou cliente, serviço e peça: os primeiros passos têm de
  // refletir isso, em vez de pedir o que já foi feito
  await expect(page.getByText('3 de 5 concluídos')).toBeVisible();
  // o gráfico do período, com o valor do dia ao passar o mouse
  await expect(page.getByRole('combobox', { name: 'O que mostrar no gráfico' })).toBeVisible();
  await captura(page, 'inicio-dashboard');

  // trocar a métrica troca a série e a unidade (contagem, não dinheiro)
  await page.getByRole('combobox', { name: 'O que mostrar no gráfico' }).selectOption('new_customers');
  await expect(page.getByRole('heading', { name: 'Novos clientes' })).toBeVisible();
  await expect(page.getByRole('table', { name: /Novos clientes por dia/ })).toBeAttached();

  // clicar num item leva para a OS dele
  await page.getByRole('link', { name: new RegExp(`OS ${oficina.numero}`) }).first().click();
  await expect(page).toHaveURL(new RegExp(`/ordens/${oficina.numero}$`));
});
