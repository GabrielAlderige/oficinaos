import AxeBuilder from '@axe-core/playwright';
import {
  abrirAbaDaOS,
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
 * O fim do ciclo: finalizar, avisar o cliente e entregar. A entrega com saldo
 * em aberto é permitida (o fiado existe), mas não pode acontecer por distração.
 */
test('finalizar, avisar que está pronto e entregar devendo pede confirmação', async ({ page }) => {
  const oficina = await criarOficina('entrega', 'ENT1A23');
  const ordem = await abrirOS(oficina);
  const orcamento = await enviarOrcamento(oficina, ordem.id);

  await api(`/quotes/${orcamento.id}/manual-decision`, {
    token: oficina.token,
    payload: { decision: 'APPROVED', channel: 'PHONE', signerName: 'João Pereira' },
  });

  await entrarNoPainel(page, oficina.email);
  await page.goto(`/ordens/${ordem.number}`);
  await expect(page.getByRole('heading', { name: new RegExp(`^OS ${ordem.number}`) })).toBeVisible();

  await test.step('executar e finalizar', async () => {
    await page.getByRole('button', { name: 'Iniciar execução', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Finalizar serviço', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Finalizar serviço', exact: true }).click();
    // finalizar tira peça do estoque e cria conta a receber: confirma antes (E34)
    await page.getByRole('alertdialog').getByRole('button', { name: 'Finalizar serviço' }).click();

    // a peça sai do estoque na finalização: 4 em estoque, 2 na OS
    await expect(page.getByText(/dispon[ií]vel: 2/)).toBeVisible();
    await captura(page, 'entrega-01-finalizada');
  });

  await test.step('o botão de avisar o cliente aparece com a OS finalizada', async () => {
    await expect(page.getByRole('button', { name: 'Avisar que está pronto', exact: true })).toBeVisible();
    await captura(page, 'entrega-02-avisar');
  });

  await test.step('entregar devendo avisa do saldo antes de confirmar', async () => {
    await page.getByRole('button', { name: 'Entregar veículo', exact: true }).click();

    // desde a E28 o aviso do saldo mora DENTRO do diálogo de entrega, junto da
    // assinatura: é a mesma decisão, tomada na mesma tela
    const dialogo = page.getByRole('dialog');
    const aviso = await textoDe(dialogo);
    expect(aviso, 'a pessoa vê quanto falta antes de confirmar').toContain('R$ 680,00');
    await captura(page, 'entrega-03-confirmar');

    // sem o interruptor ligado, a assinatura não é exigida: entrega em um clique
    await dialogo.getByRole('button', { name: 'Entregar veículo', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    const ficha = await textoDe(page.locator('main'));
    expect(ficha).toContain('Entregue');
    await captura(page, 'entrega-04-entregue');
  });
});

/**
 * Assinatura e foto na entrega (E28).
 *
 * O roteiro é o balcão: o carro está pronto, o cliente chega, assina na tela
 * com o dedo e leva o carro. O que precisa ficar provado é que a assinatura
 * desenhada vira comprovante guardado na OS — e que a oficina que exige
 * assinatura não consegue entregar sem ela.
 */
test('o cliente assina na tela e o comprovante fica na OS', async ({ page }) => {
  const oficina = await criarOficina('entrega', 'ENT1A23');
  await entrarNoPainel(page, oficina.email);

  await test.step('a oficina passa a exigir assinatura', async () => {
    await page.goto('/configuracoes/oficina');
    await page.getByLabel('Exigir a assinatura de quem recebe o veículo').check();
    await expect(page.getByText('A entrega passa a exigir assinatura.')).toBeVisible();
    await captura(page, 'entrega-05-configuracao');
  });

  // uma OS pronta para entregar: aprovada, iniciada e finalizada
  const ordem = await api<{ id: string; number: number }>('/work-orders', {
    token: oficina.token,
    payload: {
      customerId: oficina.clienteId,
      vehicleId: oficina.veiculoId,
      items: [{ type: 'SERVICE', serviceId: oficina.servicoId }],
    },
  });
  const orcamento = await api<{ id: string }>(`/work-orders/${ordem.id}/quotes`, { token: oficina.token, payload: {} });
  await api(`/quotes/${orcamento.id}/manual-decision`, {
    token: oficina.token,
    payload: { decision: 'APPROVED', channel: 'PHONE' },
  });
  await api(`/work-orders/${ordem.id}/start`, { token: oficina.token, payload: {} });
  await api(`/work-orders/${ordem.id}/complete`, { token: oficina.token, payload: {} });

  await page.goto(`/ordens/${ordem.number}`);

  await test.step('sem assinar, o botão de entregar não libera', async () => {
    await page.getByRole('button', { name: 'Entregar veículo' }).first().click();
    const dialogo = page.getByRole('dialog');
    await expect(dialogo.getByText('obrigatória nesta oficina')).toBeVisible();
    await expect(dialogo.getByRole('button', { name: 'Entregar veículo' })).toBeDisabled();
    await captura(page, 'entrega-06-sem-assinatura');
  });

  await test.step('o cliente assina com o dedo e o carro sai', async () => {
    const dialogo = page.getByRole('dialog');
    await dialogo.getByLabel('Quem recebeu').fill('Maria Pereira');
    await dialogo.getByLabel('Km na saída').fill('51200');

    // o dedo no vidro: três movimentos com o ponteiro sobre o quadro
    const quadro = dialogo.getByRole('img', { name: 'Área para assinar' });
    const caixa = (await quadro.boundingBox())!;
    await page.mouse.move(caixa.x + 30, caixa.y + caixa.height / 2);
    await page.mouse.down();
    await page.mouse.move(caixa.x + caixa.width / 2, caixa.y + 20);
    await page.mouse.move(caixa.x + caixa.width - 30, caixa.y + caixa.height - 20);
    await page.mouse.up();

    await expect(dialogo.getByText('Assinado.')).toBeVisible();
    await captura(page, 'entrega-07-assinado');

    await dialogo.getByRole('button', { name: 'Entregar veículo' }).click();
    await expect(page.getByText(`OS ${ordem.number}: veículo entregue.`)).toBeVisible();
  });

  await test.step('o comprovante fica guardado na OS', async () => {
    await abrirAbaDaOS(page, 'Histórico');
    await expect(page.getByRole('heading', { name: 'Check-in e entrega' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Assinatura de Maria Pereira' })).toBeVisible();

    const tela = await textoDe(page.getByRole('main'));
    expect(tela, 'quem recebeu o carro').toContain('recebido por Maria Pereira');
    expect(tela, 'e o km da saída').toContain('51.200 km');
    await captura(page, 'entrega-08-comprovante');

    const auditoria = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(auditoria.violations.map((v) => `${v.id}: ${v.nodes.length}`), 'acessibilidade').toEqual([]);
  });
});
