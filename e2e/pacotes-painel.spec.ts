import AxeBuilder from '@axe-core/playwright';
import { api, captura, criarOficina, entrarNoPainel, expect, test, textoDe } from './helpers';

/**
 * Pacotes de serviço (E27).
 *
 * O roteiro é o da revisão: a oficina monta "Revisão dos 10.000 km" uma vez e,
 * na OS seguinte, joga tudo com um clique. O que precisa ficar visível é que o
 * pacote vira **linhas normais** — quantidade e preço continuam editáveis.
 */
test('a oficina monta um pacote e joga na OS com um clique', async ({ page }) => {
  const oficina = await criarOficina('pacote', 'PCT1A23');
  // uma segunda peça, barata: com duas, o resumo "1 serviço · 2 peças" separa
  // o que é serviço do que é peça em vez de coincidir por acaso
  await api('/parts', {
    token: oficina.token,
    payload: { name: 'Fluido de freio', salePriceCents: 2000, initialQuantity: 3, initialUnitCostCents: 1000 },
  });
  await entrarNoPainel(page, oficina.email);

  await test.step('o pacote mora ao lado dos serviços', async () => {
    await page.goto('/servicos');
    await page.getByRole('link', { name: 'Pacotes' }).click();
    await expect(page.getByRole('heading', { name: 'Pacotes' })).toBeVisible();
    await expect(page.getByText('Nenhum pacote cadastrado')).toBeVisible();
    await captura(page, 'pacote-01-vazio');
  });

  await test.step('montar o pacote: um serviço e duas peças', async () => {
    await page.getByRole('button', { name: 'Criar o primeiro pacote' }).click();
    await page.getByLabel('Nome do pacote').fill('Revisão dos 10.000 km');
    await page.getByLabel('Descrição').fill('Pastilhas novas e a mão de obra.');

    await page.getByRole('button', { name: 'Troca de pastilhas' }).click();
    await page.getByRole('tab', { name: 'Peças' }).click();
    await page.getByRole('button', { name: /Pastilha de freio/ }).click();
    await page.getByLabel('Quantidade de Pastilha de freio').fill('2');
    await page.getByRole('button', { name: /Fluido de freio/ }).click();

    const dialogo = await textoDe(page.getByRole('dialog'));
    expect(dialogo, 'R$ 180 de serviço + 2 × R$ 250 de pastilha + R$ 20 de fluido').toContain('R$ 700,00');
    await captura(page, 'pacote-02-montando');

    await page.getByRole('button', { name: 'Criar pacote' }).click();
    await expect(page.getByText('Pacote criado.')).toBeVisible();
  });

  await test.step('na lista, o pacote mostra o preço de hoje', async () => {
    const tela = await textoDe(page.locator('main'));
    expect(tela).toContain('Revisão dos 10.000 km');
    expect(tela, 'o resumo do que entra').toContain('1 serviço · 2 peças');
    expect(tela, 'a soma do catálogo hoje').toContain('R$ 700,00');
    await captura(page, 'pacote-03-lista');

    const auditoria = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(auditoria.violations.map((v) => `${v.id}: ${v.nodes.length}`), 'acessibilidade').toEqual([]);
  });

  // uma OS vazia: assim o que aparecer nos itens veio do pacote, e de mais nada
  const ordem = await api<{ id: string; number: number }>('/work-orders', {
    token: oficina.token,
    payload: { customerId: oficina.clienteId, vehicleId: oficina.veiculoId, items: [] },
  });

  await test.step('na OS, o pacote entra com um clique — e vira linha comum', async () => {
    await page.goto(`/ordens/${ordem.number}`);
    await page.getByRole('button', { name: 'Adicionar' }).first().click();
    await page.getByRole('tab', { name: 'Pacotes' }).click();
    await captura(page, 'pacote-04-na-os');

    await page.getByRole('button', { name: /Revisão dos 10.000 km/ }).click();
    await expect(page.getByText('Revisão dos 10.000 km entrou na OS.')).toBeVisible();

    const itens = await textoDe(page.getByRole('main'));
    expect(itens, 'o serviço do pacote virou item').toContain('Troca de pastilhas');
    expect(itens, 'e a peça também, com a quantidade do pacote').toContain('Pastilha de freio');
    expect(itens, 'o total da OS é o do pacote').toContain('R$ 700,00');
    await captura(page, 'pacote-05-itens');

    // a prova de que não é um bloco fechado: a linha da peça é editável
    // com o preço editável na linha (E30), "Quantidade" existe em cada item:
    // o diálogo de edição precisa do rótulo exato
    await page.getByRole('button', { name: 'Editar Pastilha de freio' }).click();
    await page.getByRole('dialog').getByLabel('Quantidade', { exact: true }).fill('1');
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.getByText('R$ 450,00').first(), 'R$ 180 + 1 × R$ 250 + R$ 20').toBeVisible();
    await captura(page, 'pacote-06-editado');
  });
});
