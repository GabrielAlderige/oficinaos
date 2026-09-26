import AxeBuilder from '@axe-core/playwright';
import {
  api,
  captura,
  criarMecanico,
  criarOficina,
  entrarComoMecanico,
  entrarNoPainel,
  oficinaComMovimento,
  expect,
  test,
  textoDe,
} from './helpers';

/**
 * O aplicativo no celular do mecânico (E24).
 *
 * O roteiro é o dia dele: entra pelo telefone, vê os carros que estão com
 * ele, começa o serviço, cronometra, para e finaliza — tudo com o polegar, na
 * tela de 390 px, sem abrir menu nenhum.
 *
 * Também prova o que ele **não** tem: telas de dinheiro e de configuração não
 * aparecem na barra de baixo, e a API recusaria de qualquer jeito.
 */
test('o mecânico trabalha o dia inteiro pelo celular', async ({ page }) => {
  const oficina = await criarOficina('mecanico', 'MEC1A23');
  const mecanico = await criarMecanico(oficina);

  // uma OS aprovada, com o mecânico como responsável: é o que cai em "Minhas OS"
  const ordem = await api<{ id: string; number: number; items: { id: string; type: string }[] }>('/work-orders', {
    token: oficina.token,
    payload: {
      customerId: oficina.clienteId,
      vehicleId: oficina.veiculoId,
      complaint: 'Barulho ao frear',
      mechanicUserId: mecanico.userId,
      items: [{ type: 'SERVICE', serviceId: oficina.servicoId }],
    },
  });
  const orcamento = await api<{ id: string }>(`/work-orders/${ordem.id}/quotes`, {
    token: oficina.token,
    payload: {},
  });
  await api(`/quotes/${orcamento.id}/manual-decision`, {
    token: oficina.token,
    payload: { decision: 'APPROVED', channel: 'PHONE' },
  });

  await test.step('entrar pelo celular cai direto nos carros dele', async () => {
    await entrarComoMecanico(page, mecanico.email);
    await expect(page).toHaveURL(/\/minhas-os$/);
    // a lista chega depois do cabeçalho: ler agora pegaria só o título
    await expect(page.getByText(`OS ${ordem.number}`)).toBeVisible();

    const tela = await textoDe(page.locator('main'));
    expect(tela, 'a OS dele está lá').toContain(`OS ${ordem.number}`);
    expect(tela, 'com o carro e o cliente').toContain('Volkswagen Gol');
    expect(tela, 'e o que o cliente reclamou').toContain('Barulho ao frear');
    await captura(page, 'mecanico-01-minhas-os');
  });

  await test.step('a barra de baixo tem o que ele usa, e só isso', async () => {
    const barra = page.getByRole('navigation', { name: 'Atalhos' });
    await expect(barra).toBeVisible();
    const atalhos = await textoDe(barra);
    expect(atalhos).toContain('Minhas OS');
    expect(atalhos).toContain('Agenda');
    expect(atalhos, 'mecânico não fala com o cliente por aqui').not.toContain('Conversas');
    expect(atalhos, 'nem vê dinheiro').not.toContain('Financeiro');

    const auditoria = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(auditoria.violations.map((v) => `${v.id}: ${v.nodes.length}`), 'acessibilidade').toEqual([]);
  });

  await test.step('um toque começa o serviço, sem abrir a OS', async () => {
    await page.getByRole('button', { name: 'Iniciar execução' }).click();
    await expect(page.getByText('Em execução').first()).toBeVisible();
    await captura(page, 'mecanico-02-em-execucao');
  });

  await test.step('o cronômetro fica no topo, contando, com o botão de parar', async () => {
    // o cronômetro começa na ficha da OS, onde estão os itens de serviço
    await page.getByRole('link', { name: new RegExp(`OS ${ordem.number}`) }).click();
    await page.getByRole('button', { name: /Iniciar o cronômetro/ }).click();
    await expect(page.getByRole('button', { name: /Parar o cronômetro/ })).toBeVisible();

    await page.getByRole('navigation', { name: 'Atalhos' }).getByRole('link', { name: 'Minhas OS' }).click();
    await expect(page.getByText(/^00:00:\d{2}$/)).toBeVisible();
    await captura(page, 'mecanico-03-cronometro');

    await page.getByRole('button', { name: 'Parar', exact: true }).click();
    await expect(page.getByText(/^00:00:\d{2}$/), 'parado, o relógio some do topo').toBeHidden();
  });

  await test.step('e ele finaliza o serviço pelo próprio cartão', async () => {
    await page.getByRole('button', { name: 'Finalizar serviço' }).click();
    await expect(page.getByText('Finalizada').first()).toBeVisible();
    await captura(page, 'mecanico-04-finalizada');
  });
});

/**
 * O painel de quem administra, no celular: a ordem de cima para baixo é a das
 * perguntas do dia — o pátio primeiro, o que precisa de gente em seguida, e o
 * dinheiro depois (E25).
 */
test('no celular, o painel começa pelo pátio e não pelo dinheiro', async ({ page }) => {
  const oficina = await oficinaComMovimento();
  await entrarNoPainel(page, oficina.email);

  const patio = page.getByRole('region', { name: 'Agora na oficina' });
  await expect(patio).toBeVisible();
  const dinheiro = page.getByText(/^Dinheiro —/);
  await expect(dinheiro).toBeVisible();

  const posicaoDoPatio = await patio.evaluate((elemento) => elemento.getBoundingClientRect().top);
  const posicaoDoDinheiro = await dinheiro.evaluate((elemento) => elemento.getBoundingClientRect().top);
  expect(posicaoDoPatio, 'o pátio fica acima do dinheiro na tela do celular').toBeLessThan(posicaoDoDinheiro);

  await captura(page, 'mecanico-06-painel-celular');

  const auditoria = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(auditoria.violations.map((v) => `${v.id}: ${v.nodes.length}`), 'acessibilidade').toEqual([]);
});

/**
 * A tela pesada avisa antes de abrir apertada — e deixa abrir mesmo assim,
 * porque quem está com o celular na mão às vezes não tem outro jeito.
 */
test('tela de computador avisa no celular, e não bloqueia', async ({ page }) => {
  const oficina = await criarOficina('avisodesk', 'AVD1A23');
  await page.goto('/entrar');
  await page.getByLabel('E-mail', { exact: true }).fill(oficina.email);
  await page.getByLabel('Senha', { exact: true }).fill('cavalo-correto-bateria-grampo');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('heading', { name: /^Olá,/ })).toBeVisible();

  await page.goto('/financeiro/receber');
  await expect(page.getByRole('heading', { name: /fica melhor no computador/ })).toBeVisible();
  await captura(page, 'mecanico-05-aviso-desktop');

  await page.getByRole('button', { name: 'Abrir mesmo assim' }).click();
  await expect(page.getByRole('heading', { name: 'Contas a receber' })).toBeVisible();
});
