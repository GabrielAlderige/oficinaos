import AxeBuilder from '@axe-core/playwright';
import { api, captura, criarOficina, entrarNoPainel, expect, test, textoDe, type Oficina } from './helpers';

interface ItemOs {
  id: string;
  partId: string | null;
  sourcing: string;
  stockStatus: string;
  reservedQuantity: number;
}

async function osComPecaParaComprar(oficina: Oficina, partId: string) {
  const os = await api<{ id: string; number: number; items: ItemOs[] }>('/work-orders', {
    token: oficina.token,
    payload: {
      customerId: oficina.clienteId,
      vehicleId: oficina.veiculoId,
      items: [
        { type: 'SERVICE', serviceId: oficina.servicoId },
        { type: 'PART', partId, quantity: 2, unitPriceCents: 32000, sourcing: 'TO_ORDER' },
      ],
    },
  });
  const orcamento = await api<{ id: string }>(`/work-orders/${os.id}/quotes`, { token: oficina.token, payload: {} });
  await api(`/quotes/${orcamento.id}/manual-decision`, { token: oficina.token, payload: { decision: 'APPROVED', channel: 'PHONE' } });
  return os;
}

/**
 * Compras (E12), do lado de quem compra: a OS tem peça para comprar; o gerente
 * monta o pedido, manda ao fornecedor, recebe com o frete no custo, a peça fica
 * reservada para a OS — e uma devolução corrige o recebimento.
 */
test('pede a peça da OS, recebe com frete no custo e devolve a que veio com defeito', async ({ page }) => {
  const oficina = await criarOficina('compras', 'CPR1A23');
  await api('/suppliers', { token: oficina.token, payload: { name: 'Central Autopeças', whatsapp: '(11) 98888-7777', contactName: 'Roberto' } });
  const disco = await api<{ id: string }>('/parts', { token: oficina.token, payload: { name: 'Disco de freio ventilado', manufacturerCode: 'DF-220' } });
  const os = await osComPecaParaComprar(oficina, disco.id);

  await entrarNoPainel(page, oficina.email);
  await page.goto(`/ordens/${os.number}`);
  await expect(page.getByText('1 peça marcada "Comprar" sem pedido.')).toBeVisible();
  await page.getByRole('link', { name: 'Pedir peças' }).click();

  // o formulário já vem com a peça da OS
  await expect(page.getByRole('heading', { name: `Pedir peças da OS ${os.number}` })).toBeVisible();
  await expect(page.getByText(`DF-220 · para a OS ${os.number}`)).toBeVisible();
  await page.getByLabel('Custo unitário').fill('195,00');
  await page.getByLabel('Fornecedor').selectOption({ label: 'Central Autopeças' });
  await page.getByLabel('Frete combinado').fill('15,00');
  await expect(page.getByText('R$ 405,00')).toBeVisible();
  await captura(page, 'compras-01-rascunho');
  await page.getByRole('button', { name: 'Criar rascunho' }).click();

  await expect(page.getByRole('heading', { name: /Pedido de compra nº 1/ })).toBeVisible();
  await expect(page.getByText('Rascunho', { exact: true })).toBeVisible();

  // marcar como pedido: a mensagem sai pronta para o WhatsApp do fornecedor
  await page.getByRole('button', { name: 'Marcar como pedido' }).click();
  const pedir = page.getByRole('dialog');
  await pedir.getByLabel('Previsão de entrega').fill('2026-09-18');
  await pedir.getByRole('button', { name: 'Marcar como pedido' }).click();
  await expect(pedir.getByText('Confirmando o pedido nº 1:')).toBeVisible();
  expect(await textoDe(pedir.locator('pre'))).toContain('2 un × Disco de freio ventilado (DF-220) — R$ 195,00 cada');
  const whatsapp = await pedir.getByRole('link', { name: 'Enviar pelo WhatsApp' }).getAttribute('href');
  expect(whatsapp).toMatch(/^https:\/\/wa\.me\/5511988887777\?text=/);
  await captura(page, 'compras-02-pedido-feito');
  await page.keyboard.press('Escape');
  await expect(page.getByText('Pedido feito', { exact: true })).toBeVisible();

  // receber: o frete combinado vem preenchido e o custo com frete aparece antes de confirmar
  await page.getByRole('button', { name: 'Receber' }).click();
  const receber = page.getByRole('dialog', { name: 'Receber o pedido nº 1' });
  await expect(receber.getByLabel('Chegou')).toHaveValue('2');
  await expect(receber.getByLabel('Frete desta entrega')).toHaveValue('15,00');
  // R$ 195,00 + R$ 15,00 / 2 = R$ 202,50 cada
  await expect(receber.getByText('entra no estoque a R$ 202,50 cada')).toBeVisible();
  await receber.getByLabel('Nota fiscal').fill('NF 4521');
  await captura(page, 'compras-03-receber');
  await receber.getByRole('button', { name: 'Dar entrada no estoque' }).click();
  await expect(page.getByText('Recebido', { exact: true })).toBeVisible();
  await expect(page.getByText(/Chegada · NF 4521/)).toBeVisible();

  // a peça ficou reservada para a OS e o estoque tem o custo com frete
  const ficha = await api<{ items: ItemOs[] }>(`/work-orders/${os.number}`, { token: oficina.token });
  expect(ficha.items.find((i) => i.partId === disco.id)).toMatchObject({ sourcing: 'STOCK', stockStatus: 'RESERVED', reservedQuantity: 2 });
  expect(await api<{ quantityOnHand: number; averageCostCents: number }>(`/parts/${disco.id}`, { token: oficina.token })).toMatchObject({
    quantityOnHand: 2,
    averageCostCents: 20250,
  });

  // um veio com defeito: devolve, a reserva desfaz e a peça volta a faltar
  await page.getByRole('button', { name: 'Devolver' }).click();
  const devolver = page.getByRole('dialog', { name: 'Devolver ao fornecedor' });
  await devolver.getByLabel('Devolver', { exact: true }).fill('1');
  await devolver.getByLabel('Motivo').fill('Um veio empenado');
  await devolver.getByRole('button', { name: 'Registrar devolução' }).click();
  await expect(page.getByText('Chegou em parte', { exact: true })).toBeVisible();
  await expect(page.getByText('Motivo: Um veio empenado')).toBeVisible();
  await captura(page, 'compras-04-devolvido');

  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(violations.map((v) => `${v.id} (${v.nodes.length}): ${v.help} ${v.nodes.map((n) => n.html).join(' / ')}`)).toEqual([]);

  expect(await api<{ quantityOnHand: number; quantityReserved: number }>(`/parts/${disco.id}`, { token: oficina.token })).toMatchObject({
    quantityOnHand: 1,
    quantityReserved: 1,
  });

  // a OS mostra a compra; a lista de compras, o pedido em aberto
  await page.goto(`/ordens/${os.number}`);
  await expect(page.getByRole('link', { name: /Disco de freio ventilado.*pedido nº 1/ })).toBeVisible();
  const timeline = await api<{ data: { type: string }[] }>(`/work-orders/${os.id}/timeline`, { token: oficina.token });
  expect(timeline.data.map((e) => e.type)).toEqual(expect.arrayContaining(['PURCHASE_ORDERED', 'PURCHASE_RECEIVED']));

  await page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Compras' }).click();
  await expect(page.getByRole('heading', { name: 'Compras', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /nº 1.*Central Autopeças/ })).toBeVisible();
  await captura(page, 'compras-05-lista');
});

test('a cotação escolhida vira rascunho de pedido com um clique', async ({ page }) => {
  const oficina = await criarOficina('cotcompra', 'CTC1A23');
  const fornecedor = await api<{ id: string }>('/suppliers', { token: oficina.token, payload: { name: 'Distribuidora Paulista' } });
  const disco = await api<{ id: string }>('/parts', { token: oficina.token, payload: { name: 'Disco de freio ventilado' } });
  const os = await osComPecaParaComprar(oficina, disco.id);
  const itemDisco = os.items.find((i) => i.partId === disco.id)!;
  const criada = await api<{ quote: { id: string }; links: { link: string }[] }>('/supplier-quotes', {
    token: oficina.token,
    payload: { workOrderId: os.id, workOrderItemIds: [itemDisco.id], supplierIds: [fornecedor.id] },
  });
  const token = criada.links[0]!.link.split('/').pop()!;
  const tela = await api<{ contentHash: string; items: { id: string }[] }>(`/public/supplier-quotes/${token}`);
  await api(`/public/supplier-quotes/${token}/responses`, {
    payload: {
      contentHash: tela.contentHash,
      responderName: 'Márcia',
      shippingCents: 900,
      items: [{ requestItemId: tela.items[0]!.id, availability: 'AVAILABLE', unitPriceCents: 18900, leadTimeDays: 1 }],
    },
  });
  const quadro = await api<{ invites: { response: { items: { id: string; requestItemId: string }[] } }[] }>(`/supplier-quotes/${criada.quote.id}`, {
    token: oficina.token,
  });
  const oferta = quadro.invites[0]!.response.items[0]!;
  await api(`/supplier-quotes/${criada.quote.id}/award`, {
    token: oficina.token,
    payload: { awards: [{ requestItemId: oferta.requestItemId, responseItemId: oferta.id }] },
  });

  await entrarNoPainel(page, oficina.email);
  await page.goto(`/ordens/${os.number}/cotacoes/${criada.quote.id}`);
  await page.getByRole('button', { name: 'Gerar pedidos de compra' }).click();
  const dialogo = page.getByRole('dialog');
  await dialogo.getByRole('button', { name: 'Gerar rascunhos' }).click();
  await expect(dialogo.getByText('Rascunho de pedido criado')).toBeVisible();
  // R$ 189,00 × 2 + R$ 9,00 de frete
  expect(await textoDe(dialogo)).toContain('R$ 387,00');
  await captura(page, 'compras-06-da-cotacao');
  await dialogo.getByRole('link', { name: 'Abrir' }).click();

  await expect(page.getByRole('heading', { name: /Pedido de compra nº 1/ })).toBeVisible();
  await expect(page.getByText('nº 1', { exact: true })).toBeVisible();

  // de volta ao quadro: a escolha mostra o pedido e não se troca mais
  await page.goto(`/ordens/${os.number}/cotacoes/${criada.quote.id}`);
  await expect(page.getByRole('link', { name: 'pedido de compra nº 1' })).toBeVisible();
  await expect(page.getByRole('radio', { name: /Escolher Distribuidora Paulista/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Gerar pedidos de compra' })).toHaveCount(0);
});

test('a sugestão de compra vira rascunho e o que foi comprado aparece nos históricos', async ({ page }) => {
  const oficina = await criarOficina('sugestao', 'SGT1A23');
  const central = await api<{ id: string }>('/suppliers', { token: oficina.token, payload: { name: 'Central Autopeças' } });
  const filtro = await api<{ id: string }>('/parts', {
    token: oficina.token,
    payload: { name: 'Filtro de óleo', minQuantity: 4, initialQuantity: 1, initialUnitCostCents: 2500, preferredSupplierId: central.id },
  });

  await entrarNoPainel(page, oficina.email);
  await page.goto('/compras');
  await page.getByRole('link', { name: 'Sugestão de compra' }).click();
  await expect(page.getByRole('heading', { name: 'Sugestão de compra' })).toBeVisible();
  await expect(page.getByText('abaixo do mínimo: disponível 1 un de 4 un')).toBeVisible();
  await expect(page.getByLabel('Quantidade').first()).toHaveValue('3');
  await captura(page, 'compras-07-sugestao');
  await page.getByRole('button', { name: 'Criar rascunho de pedido' }).first().click();

  await expect(page.getByRole('heading', { name: /Pedido de compra nº 1/ })).toBeVisible();
  const pedidoId = page.url().split('/').pop()!;
  const pedido = await api<{ version: number; items: { id: string; quantity: number; unitCostCents: number }[] }>(`/purchase-orders/${pedidoId}`, {
    token: oficina.token,
  });
  expect(pedido.items[0]).toMatchObject({ quantity: 3, unitCostCents: 2500 });

  // pedido, recebido: a sugestão some e os históricos contam a compra
  const feito = await api<{ order: { items: { id: string }[] } }>(`/purchase-orders/${pedidoId}/order`, {
    token: oficina.token,
    payload: { version: pedido.version },
  });
  await api(`/purchase-orders/${pedidoId}/receipts`, {
    token: oficina.token,
    payload: { clientRequestId: crypto.randomUUID(), items: [{ purchaseOrderItemId: feito.order.items[0]!.id, quantity: 3, unitCostCents: 2400 }] },
  });
  await page.goto('/compras/sugestao');
  await expect(page.getByText('Nada para comprar agora')).toBeVisible();

  await page.goto(`/fornecedores/${central.id}`);
  await expect(page.getByRole('link', { name: /Pedido nº 1/ })).toBeVisible();
  await page.goto(`/pecas/${filtro.id}`);
  await expect(page.getByRole('heading', { name: 'Histórico de preços' })).toBeVisible();
  const precoPago = page.getByRole('listitem').filter({ hasText: 'pedido nº 1' });
  await expect(precoPago.getByText('Compra', { exact: true })).toBeVisible();
  // o preço da nota, sem frete — o custo médio (R$ 24,25) é outra conta
  expect(await textoDe(precoPago)).toContain('Central Autopeças');
  expect(await textoDe(precoPago)).toContain('R$ 24,00');
  await captura(page, 'compras-08-historico-peca');
});

/**
 * As telas de compra no celular (o gerente recebe mercadoria no balcão, com o
 * telefone na mão) e no tema escuro: sem rolagem lateral, e o escuro passa na
 * auditoria de contraste.
 */
test('telas de compra no celular e no tema escuro', async ({ page }) => {
  // nove telas com captura e quatro auditorias: não cabe nos 120 s padrão
  test.setTimeout(300_000);
  const oficina = await criarOficina('compracel', 'CEL1A23');
  const central = await api<{ id: string }>('/suppliers', { token: oficina.token, payload: { name: 'Central Autopeças Distribuidora Paulista' } });
  await api('/parts', {
    token: oficina.token,
    payload: { name: 'Filtro de ar condicionado', minQuantity: 3, preferredSupplierId: central.id },
  });
  const disco = await api<{ id: string }>('/parts', { token: oficina.token, payload: { name: 'Disco de freio ventilado dianteiro', manufacturerCode: 'DF-220-XL' } });
  const os = await osComPecaParaComprar(oficina, disco.id);
  const itemDisco = os.items.find((i) => i.partId === disco.id)!;
  const criado = await api<{ id: string; version: number }>('/purchase-orders', {
    token: oficina.token,
    payload: {
      supplierId: central.id,
      shippingCents: 1500,
      items: [
        { partId: disco.id, quantity: 2, unitCostCents: 19500, workOrderItemId: itemDisco.id },
        { partId: oficina.pecaId, quantity: 4, unitCostCents: 8000 },
      ],
    },
  });
  const feito = await api<{ order: { items: { id: string }[] } }>(`/purchase-orders/${criado.id}/order`, {
    token: oficina.token,
    payload: { version: criado.version, expectedOn: '2026-09-18' },
  });
  const [linhaDisco, linhaPastilha] = feito.order.items;
  await api(`/purchase-orders/${criado.id}/receipts`, {
    token: oficina.token,
    payload: {
      clientRequestId: crypto.randomUUID(),
      invoiceNumber: 'NF 000123456',
      shippingCents: 1500,
      items: [
        { purchaseOrderItemId: linhaDisco!.id, quantity: 2, unitCostCents: 19500 },
        { purchaseOrderItemId: linhaPastilha!.id, quantity: 2, unitCostCents: 8000 },
      ],
    },
  });
  await api(`/purchase-orders/${criado.id}/returns`, {
    token: oficina.token,
    payload: { clientRequestId: crypto.randomUUID(), reason: 'Um disco veio empenado', items: [{ purchaseOrderItemId: linhaDisco!.id, quantity: 1 }] },
  });

  const semRolagemLateral = async (tela: string) => {
    // expressão em texto: o tsconfig do e2e não carrega os tipos do navegador
    const { largura, janela } = (await page.evaluate('({ largura: document.documentElement.scrollWidth, janela: window.innerWidth })')) as {
      largura: number;
      janela: number;
    };
    expect(largura, `rolagem lateral em ${tela}`).toBeLessThanOrEqual(janela);
  };

  await entrarNoPainel(page, oficina.email);
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto('/compras');
  await expect(page.getByRole('heading', { name: 'Compras', exact: true })).toBeVisible();
  await semRolagemLateral('lista');
  await captura(page, 'compras-celular-01-lista');

  await page.goto(`/compras/${criado.id}`);
  await expect(page.getByText('Motivo: Um disco veio empenado')).toBeVisible();
  await semRolagemLateral('ficha do pedido');
  await captura(page, 'compras-celular-02-ficha');

  await page.getByRole('button', { name: 'Receber' }).click();
  await expect(page.getByRole('dialog', { name: /Receber o pedido/ })).toBeVisible();
  await semRolagemLateral('receber');
  await captura(page, 'compras-celular-03-receber');
  await page.keyboard.press('Escape');

  await page.goto('/compras/sugestao');
  await expect(page.getByText(/abaixo do mínimo/)).toBeVisible();
  await semRolagemLateral('sugestão');
  await captura(page, 'compras-celular-04-sugestao');

  await page.goto(`/compras/novo?os=${os.number}`);
  await expect(page.getByRole('heading', { name: `Pedir peças da OS ${os.number}` })).toBeVisible();
  await semRolagemLateral('novo pedido');
  await captura(page, 'compras-celular-05-novo');

  // tema escuro, no computador
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/compras/${criado.id}`);
  await page.getByRole('button', { name: 'Usar tema escuro', exact: true }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  for (const [caminho, nome, pronto] of [
    [`/compras/${criado.id}`, 'compras-escuro-01-ficha', /Motivo: Um disco veio empenado/],
    ['/compras/sugestao', 'compras-escuro-02-sugestao', /abaixo do mínimo/],
    [`/pecas/${disco.id}`, 'compras-escuro-03-historico-peca', /Histórico de preços/],
    [`/fornecedores/${central.id}`, 'compras-escuro-04-fornecedor', /Pedidos de compra/],
  ] as const) {
    await page.goto(caminho);
    await expect(page.getByText(pronto).first()).toBeVisible();
    const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(violations.map((v) => `${v.id} (${v.nodes.length}): ${v.help} ${v.nodes.map((n) => n.html).join(' / ')}`), nome).toEqual([]);
    await captura(page, nome);
  }
});
