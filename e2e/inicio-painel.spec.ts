import AxeBuilder from '@axe-core/playwright';
import { captura, entrarNoPainel, expect, oficinaComMovimento, test, textoDe } from './helpers';

/**
 * Painel de Início (E9, redesenhado na E25).
 *
 * O que precisa ficar provado na tela, na ordem das perguntas de quem abre a
 * oficina de manhã: o **pátio agora** (que não muda com o período escolhido),
 * o que **precisa de gente**, e só então o dinheiro do período — com faturado
 * e recebido lado a lado, que são contas diferentes.
 */
test('o painel mostra o pátio, o que travou e o dinheiro do período', async ({ page }) => {
  const oficina = await oficinaComMovimento();
  await entrarNoPainel(page, oficina.email);

  await test.step('o pátio vem primeiro, e não depende do período', async () => {
    const patio = page.getByRole('region', { name: 'Agora na oficina' });
    await expect(patio).toBeVisible();
    const numeros = await textoDe(patio);
    expect(numeros).toContain('Na oficina');
    expect(numeros).toContain('Aguardando aprovação');
    expect(numeros).toContain('Prontos para entregar');
    expect(numeros, 'a tela avisa que este bloco ignora o período').toContain('independe do período');

    // o número de cada cartão é o daquele cartão: a oficina do cenário tem um
    // carro dentro, um orçamento esperando resposta, nada pronto e nada agendado
    await expect(patio.getByRole('link', { name: /^Na oficina 1/ })).toBeVisible();
    await expect(patio.getByRole('link', { name: /^Aguardando aprovação 1/ })).toBeVisible();
    await expect(patio.getByRole('link', { name: /^Prontos para entregar 0/ })).toBeVisible();
    await expect(patio.getByRole('link', { name: /^Agendados hoje 0/ })).toBeVisible();

    // cada número abre a lista dele: número que não leva a lugar nenhum é
    // número que a pessoa vai procurar de outro jeito
    await expect(patio.getByRole('link', { name: /Aguardando aprovação/ })).toHaveAttribute('href', '/orcamentos');
    await expect(patio.getByRole('link', { name: /Prontos para entregar/ })).toHaveAttribute(
      'href',
      '/ordens?status=COMPLETED',
    );
  });

  await test.step('o que travou aparece com caminho para resolver', async () => {
    await expect(page.getByText('Orçamentos aguardando resposta')).toBeVisible();
    await expect(page.getByText('Entregues com saldo em aberto')).toBeVisible();
  });

  await test.step('faturado e recebido, lado a lado, sem virar porcentagem', async () => {
    const dinheiro = page.getByText(/^Dinheiro —/);
    await expect(dinheiro).toBeVisible();
    const tela = await textoDe(page.locator('main'));
    expect(tela, 'o que a oficina entregou').toContain('R$ 680,00');
    expect(tela, 'o que entrou no caixa').toContain('R$ 100,00');
    expect(tela, 'a ressalva fica escrita').toContain('Faturar não é receber');
    await captura(page, 'inicio-dashboard');
  });

  await test.step('a produção e os primeiros passos ficam em segundo plano', async () => {
    const tela = await textoDe(page.locator('main'));
    expect(tela).toContain('Serviços concluídos');
    // a oficina já cadastrou cliente, serviço e peça: os primeiros passos têm
    // de refletir isso, em vez de pedir o que já foi feito
    expect(tela).toContain('3 de 5 concluídos');

    const auditoria = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(auditoria.violations.map((v) => `${v.id}: ${v.nodes.length}`), 'acessibilidade').toEqual([]);
  });

  await test.step('o gráfico troca de métrica e leva a tabela junto', async () => {
    await page.getByRole('combobox', { name: 'O que mostrar no gráfico' }).selectOption('new_customers');
    await expect(page.getByRole('heading', { name: 'Novos clientes' })).toBeVisible();
    await expect(page.getByRole('table', { name: /Novos clientes por dia/ })).toBeAttached();
  });

  await test.step('clicar no item travado leva para a OS dele', async () => {
    await page
      .getByRole('link', { name: new RegExp(`OS ${oficina.numero}`) })
      .first()
      .click();
    await expect(page).toHaveURL(new RegExp(`/ordens/${oficina.numero}$`));
  });
});
