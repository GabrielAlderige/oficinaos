import AxeBuilder from '@axe-core/playwright';
import { api, BASE_URL, captura, criarOficina, expect, test, textoDe } from './helpers';

const PLACA = 'FNC2B34';
const CHASSI = '9BWAB45U0KT000777';

interface Criada {
  quote: { id: string; items: { id: string; description: string }[] };
  links: { link: string }[];
}

interface Quadro {
  items: { id: string; description: string }[];
  invites: {
    versions: number;
    response: { responderName: string; shippingCents: number | null; items: { id: string; requestItemId: string; availability: string; unitPriceCents: number | null; leadTimeDays: number | null; brand: string | null }[] } | null;
  }[];
}

/**
 * A página do fornecedor (E11), no celular: é o balconista da autopeças que
 * abre o link entre um atendimento e outro. Precisa responder sem conta, sem
 * ver o cliente da oficina, corrigir se errou — e parar quando a oficina fecha.
 */
test('o fornecedor responde pelo celular, corrige e vê a cotação encerrar', async ({ page, ignorarErros }) => {
  const oficina = await criarOficina('fornecedor', 'FNC1A23');
  const cliente = await api<{ id: string }>('/customers', {
    token: oficina.token,
    payload: { name: 'Cliente Sigiloso da Silva', whatsapp: '(11) 97777-1234' },
  });
  const carro = await api<{ id: string }>('/vehicles', {
    token: oficina.token,
    payload: { customerId: cliente.id, make: 'Volkswagen', model: 'Gol', version: '1.6 MSI', engine: 'EA211', yearModel: 2019, plate: PLACA, vin: CHASSI },
  });
  const disco = await api<{ id: string }>('/parts', { token: oficina.token, payload: { name: 'Disco de freio ventilado', manufacturerCode: 'DF-220' } });
  const ordem = await api<{ id: string; items: { id: string; type: string }[] }>('/work-orders', {
    token: oficina.token,
    payload: {
      customerId: cliente.id,
      vehicleId: carro.id,
      items: [
        { type: 'PART', partId: disco.id, quantity: 2, unitPriceCents: 32000 },
        { type: 'PART', partId: oficina.pecaId, quantity: 1 },
      ],
    },
  });
  const fornecedor = await api<{ id: string }>('/suppliers', { token: oficina.token, payload: { name: 'Central Autopeças' } });
  const criada = await api<Criada>('/supplier-quotes', {
    token: oficina.token,
    payload: {
      workOrderId: ordem.id,
      workOrderItemIds: ordem.items.map((item) => item.id),
      supplierIds: [fornecedor.id],
      includeVin: true,
      message: 'Carro parado, preciso para amanhã.',
    },
  });
  const link = criada.links[0]!.link.replace('http://localhost:5173', BASE_URL);

  await page.goto(link);
  await expect(page.getByRole('heading', { name: 'Cotação de peças nº 1' })).toBeVisible();
  await expect(page.getByText('Olá, Central Autopeças.')).toBeVisible();
  await expect(page.getByText('Volkswagen Gol 1.6 MSI 2019')).toBeVisible();
  await expect(page.getByText(`Motor EA211 · Chassi ${CHASSI}`)).toBeVisible();
  await expect(page.getByText('Carro parado, preciso para amanhã.')).toBeVisible();
  // nada do cliente da oficina na página inteira: nem placa, nem nome, nem telefone
  const pagina = await textoDe(page.locator('body'));
  expect(pagina).not.toContain(PLACA);
  expect(pagina).not.toContain('Sigiloso');
  expect(pagina).not.toContain('97777');
  await captura(page, 'cotacao-fornecedor-01-aberta');

  const disco1 = page.locator('li').filter({ hasText: 'Disco de freio ventilado' });
  const pastilha = page.locator('li').filter({ hasText: 'Pastilha de freio' });
  await expect(disco1.getByText('Quantidade: 2 un · Código DF-220')).toBeVisible();

  // tentar enviar sem dizer nada: a tela aponta o que falta, sem ir à API
  await page.getByRole('button', { name: 'Enviar resposta' }).click();
  await expect(disco1.getByText('Diga se tem a peça')).toBeVisible();
  await expect(pastilha.getByText('Diga se tem a peça')).toBeVisible();

  // disco: tem, com preço no formato do balcão; pastilha: não tem
  await disco1.getByText('Tenho', { exact: true }).click();
  await disco1.getByLabel('Preço unitário (R$)').fill('1.250,00');
  await disco1.getByLabel('Prazo (dias)').fill('0');
  await disco1.getByLabel('Marca').fill('Fremax');
  await pastilha.getByText('Não tenho', { exact: true }).click();
  await expect(pastilha.getByLabel('Preço unitário (R$)')).toHaveCount(0);
  await page.getByLabel('Frete (R$)').fill('20');
  await page.getByRole('button', { name: 'Enviar resposta' }).click();
  await expect(page.getByText('Informe o seu nome')).toBeVisible();
  await page.getByLabel('Seu nome').fill('Roberto');
  await captura(page, 'cotacao-fornecedor-02-preenchida');
  await page.getByRole('button', { name: 'Enviar resposta' }).click();

  // a conferência mostra a conta: 2 × R$ 1.250,00 + frete R$ 20,00
  const conferencia = page.getByRole('dialog', { name: 'Confira antes de enviar' });
  const textoConferencia = await textoDe(conferencia);
  expect(textoConferencia).toContain('R$ 1.250,00');
  expect(textoConferencia).toContain('R$ 2.500,00');
  expect(textoConferencia).toContain('R$ 2.520,00');
  await captura(page, 'cotacao-fornecedor-03-conferencia');
  await conferencia.getByRole('button', { name: 'Confirmar e enviar' }).click();
  await expect(page.getByText('Resposta enviada. Obrigado!')).toBeVisible();

  let quadro = await api<Quadro>(`/supplier-quotes/${criada.quote.id}`, { token: oficina.token });
  const idDisco = quadro.items.find((item) => item.description === 'Disco de freio ventilado')!.id;
  let resposta = quadro.invites[0]!.response!;
  expect(resposta.responderName).toBe('Roberto');
  expect(resposta.shippingCents).toBe(2000);
  expect(resposta.items.find((o) => o.requestItemId === idDisco)).toMatchObject({ availability: 'AVAILABLE', unitPriceCents: 125000, leadTimeDays: 0, brand: 'Fremax' });

  // voltou depois: a resposta dele vem preenchida, e ele corrige o preço
  await page.reload();
  await expect(page.getByText(/Você respondeu em/)).toBeVisible();
  await expect(disco1.getByLabel('Preço unitário (R$)')).toHaveValue('1.250,00');
  await disco1.getByLabel('Preço unitário (R$)').fill('1100');
  await page.getByRole('button', { name: 'Enviar correção' }).click();
  await page.getByRole('dialog', { name: 'Confira antes de enviar' }).getByRole('button', { name: 'Confirmar e enviar' }).click();
  await expect(page.getByText('Resposta enviada. Obrigado!')).toBeVisible();

  quadro = await api<Quadro>(`/supplier-quotes/${criada.quote.id}`, { token: oficina.token });
  resposta = quadro.invites[0]!.response!;
  expect(quadro.invites[0]!.versions).toBe(2);
  const ofertaDisco = resposta.items.find((o) => o.requestItemId === idDisco)!;
  expect(ofertaDisco.unitPriceCents).toBe(110000);

  // a página do fornecedor passa na auditoria automática
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(violations.map((v) => `${v.id} (${v.nodes.length}): ${v.help} ${v.nodes.map((n) => n.html).join(' / ')}`)).toEqual([]);

  // a oficina escolhe: a página passa a dizer que encerrou, e nada mais é editável
  await api(`/supplier-quotes/${criada.quote.id}/award`, {
    token: oficina.token,
    payload: { awards: [{ requestItemId: idDisco, responseItemId: ofertaDisco.id }] },
  });
  await page.reload();
  await expect(page.getByText('A oficina já escolheu as ofertas')).toBeVisible();
  await expect(page.getByRole('button', { name: /Enviar/ })).toHaveCount(0);
  await expect(disco1.getByLabel('Preço unitário (R$)')).toBeDisabled();
  await captura(page, 'cotacao-fornecedor-04-encerrada');

  // link torto ou inventado: mensagem clara, sem expor nada (o 404 é o esperado)
  ignorarErros.push(/status of 404/);
  await page.goto(`${BASE_URL}/cotacao/${'A'.repeat(43)}`);
  await expect(page.getByText('Link de cotação inválido')).toBeVisible();
});
