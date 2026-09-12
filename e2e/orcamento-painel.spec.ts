import {
  abrirOS,
  captura,
  criarOficina,
  entrarNoPainel,
  expect,
  test,
  textoDe,
} from './helpers';

/**
 * O caminho da OFICINA: enviar o orçamento pela tela da OS, acompanhar a
 * visualização, ser avisada pelo sino e registrar a resposta que veio por fora
 * do link (metade dos clientes responde por telefone).
 */
test('a oficina envia o orçamento, acompanha e registra a resposta', async ({ page }) => {
  const oficina = await criarOficina('painel', 'PNL1A23');
  const ordem = await abrirOS(oficina);

  await entrarNoPainel(page, oficina.email);

  await test.step('a OS sem orçamento convida a enviar', async () => {
    await page.goto(`/ordens/${ordem.number}`);
    await expect(page.getByRole('heading', { name: new RegExp(`^OS ${ordem.number}`) })).toBeVisible();

    const antes = await textoDe(page.locator('main'));
    expect(antes).toContain('Mande o link e deixe o cliente aprovar pelo celular');
    expect(antes).toContain('2 itens prontos para orçar');
    await captura(page, 'painel-01-sem-orcamento');
  });

  await test.step('o envio congela os itens e mostra o que o cliente vai ver', async () => {
    await page.getByRole('button', { name: 'Enviar orçamento', exact: true }).click();
    const dialogo = page.getByRole('dialog');
    await expect(dialogo.getByRole('heading', { name: 'Enviar orçamento', exact: true })).toBeVisible();

    const corpo = await textoDe(dialogo);
    expect(corpo).toContain('Troca de pastilhas');
    expect(corpo).toContain('R$ 680,00');
    expect(corpo).toContain('1 item recomendado');

    await dialogo.getByLabel('Recado para o cliente', { exact: true }).fill('As pastilhas estão no fim.');
    await captura(page, 'painel-02-dialogo');

    await dialogo.getByRole('button', { name: 'Gerar orçamento', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Enviar pelo WhatsApp', exact: true })).toBeVisible();
  });

  let link = '';
  await test.step('o cartão mostra link, situação e que o cliente ainda não abriu', async () => {
    const depois = await textoDe(page.locator('main'));
    expect(depois).toContain('Aguardando resposta');
    expect(depois).toContain('O cliente ainda não abriu o link');
    expect(depois, 'a OS entra em aguardando aprovação').toContain('Aguardando aprovação');

    const achado = depois.match(/https?:\/\/[^\s]+\/orcamento\/[A-Za-z0-9_-]+/);
    expect(achado, 'o link público deveria aparecer no cartão').not.toBeNull();
    link = achado?.[0] ?? '';
    await captura(page, 'painel-03-com-orcamento');
  });

  await test.step('depois de o cliente abrir, a oficina vê que foi visto', async () => {
    const doCliente = await page.context().newPage();
    await doCliente.goto(link);
    await expect(doCliente.getByRole('heading', { name: 'Orçamento para seu veículo', exact: true })).toBeVisible();
    await doCliente.close();

    await page.reload();
    // o contador pode passar de 1 com uma só abertura (em dev o React monta duas
    // vezes); o que a oficina precisa ver é que saiu de "ainda não abriu"
    await expect(page.getByText(/Visto \d+ vez/)).toBeVisible();
    expect(await textoDe(page.locator('main'))).not.toContain('O cliente ainda não abriu o link');
    await captura(page, 'painel-04-visualizado');
  });

  await test.step('o sino avisa sem precisar recarregar', async () => {
    const sino = page.getByRole('button', { name: /^Avisos/ });
    await expect(sino).toBeVisible();
    await expect(sino, 'o sino deveria marcar aviso não lido').toHaveAttribute('aria-label', /não lidos/);

    await sino.click();
    await expect(page.getByRole('menu').getByText('Orçamento visualizado')).toBeVisible();
    await captura(page, 'painel-05-sino');
    await page.keyboard.press('Escape');
  });

  await test.step('a resposta por telefone vale o mesmo que o link', async () => {
    await page.getByRole('button', { name: 'Registrar resposta', exact: true }).click();
    const decisao = page.getByRole('dialog');
    await expect(decisao.getByRole('heading', { name: 'Registrar resposta do cliente', exact: true })).toBeVisible();

    await decisao.getByRole('radio', { name: 'Aprovou tudo', exact: true }).click();
    await decisao.getByLabel('Como o cliente respondeu', { exact: true }).selectOption('PHONE');
    await decisao.getByLabel('Quem autorizou', { exact: true }).fill('João Pereira');
    await captura(page, 'painel-06-registrar');

    await decisao.getByRole('button', { name: 'Registrar resposta', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    const decidido = await textoDe(page.locator('main'));
    expect(decidido).toContain('Aprovou tudo');
    expect(decidido, 'quem autorizou fica registrado').toContain('João Pereira');
    expect(decidido).toContain('Aprovado: R$ 680,00');
    expect(decidido, 'depois de decidido não se manda mais o link').not.toContain('Enviar pelo WhatsApp');
    await captura(page, 'painel-07-decidido');
  });

  await test.step('tema escuro', async () => {
    await page.getByRole('button', { name: 'Usar tema escuro', exact: true }).click();
    await captura(page, 'painel-08-escuro');
  });

  await test.step('no celular o orçamento vem antes dos itens', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Usar tema claro', exact: true }).click();
    await captura(page, 'painel-09-celular');

    // comparar TEXTO não serve: `order-first` é CSS e não mexe na ordem do DOM,
    // que é o que innerText percorre. Quem decide é a posição na tela.
    const orcamento = await page.getByRole('heading', { name: /^Orçamento 1/ }).boundingBox();
    const itens = await page.getByRole('heading', { name: 'Itens', exact: true }).boundingBox();
    expect(orcamento && itens).toBeTruthy();
    expect(orcamento?.y, 'o orçamento é a ação do dia: não pode ficar abaixo dos itens').toBeLessThan(itens?.y ?? 0);
  });

  await test.step('a lista de orçamentos filtra por situação', async () => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/orcamentos');
    await expect(page.getByRole('heading', { name: 'Orçamentos', exact: true })).toBeVisible();
    // o único orçamento desta oficina foi aprovado, então "aguardando" fica vazio
    await expect(page.getByText('Nenhum orçamento esperando resposta')).toBeVisible();
    await captura(page, 'painel-10-lista-aguardando');

    await page.getByRole('button', { name: 'Aprovado', exact: true }).click();
    await expect(page.getByText('João Pereira')).toBeVisible();
    const lista = await textoDe(page.locator('main'));
    expect(lista).toContain('R$ 680,00');
    expect(lista).toContain('PNL1A23');
    await captura(page, 'painel-11-lista-aprovado');
  });
});
