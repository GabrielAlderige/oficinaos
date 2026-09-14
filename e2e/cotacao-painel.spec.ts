import AxeBuilder from '@axe-core/playwright';
import { api, BASE_URL, captura, criarOficina, entrarNoPainel, expect, test, textoDe } from './helpers';

interface Tela {
  contentHash: string;
  items: { id: string; description: string }[];
}

/** O fornecedor responde pelo link dele — aqui pela API pública, sem login. */
async function responder(link: string, nome: string, precos: (number | null)[], prazo: number) {
  const token = link.slice(link.lastIndexOf('/') + 1);
  const tela = await api<Tela>(`/public/supplier-quotes/${token}`);
  await api(`/public/supplier-quotes/${token}/responses`, {
    payload: {
      contentHash: tela.contentHash,
      responderName: nome,
      shippingCents: 1500,
      items: tela.items.map((item, i) => ({
        requestItemId: item.id,
        availability: precos[i] === null ? 'UNAVAILABLE' : 'AVAILABLE',
        unitPriceCents: precos[i],
        leadTimeDays: prazo,
      })),
    },
  });
}

/**
 * Cotação de peças com fornecedores (E11), do lado da oficina: da OS sai o
 * pedido, cada fornecedor recebe o próprio link, as respostas chegam no quadro
 * e o gerente escolhe — e o custo da peça em rascunho passa a ser o escolhido.
 */
test('cota a peça com dois fornecedores, compara e escolhe', async ({ page }) => {
  const oficina = await criarOficina('cotacao', 'COT1A23');
  const categorias = await api<{ data: { id: string; name: string }[] }>('/part-categories', { token: oficina.token });
  const freios = categorias.data.find((c) => c.name === 'Freios');
  const central = await api<{ id: string }>('/suppliers', {
    token: oficina.token,
    payload: { name: 'Central Autopeças', whatsapp: '(11) 98888-7777', contactName: 'Roberto' },
  });
  await api('/suppliers', { token: oficina.token, payload: { name: 'Distribuidora Paulista', categories: ['Freios'] } });
  await api('/suppliers', { token: oficina.token, payload: { name: 'Loja Do Escapamento', categories: ['Escapamento'] } });
  const disco = await api<{ id: string }>('/parts', {
    token: oficina.token,
    payload: { name: 'Disco de freio ventilado', manufacturerCode: 'DF-220', categoryId: freios?.id ?? null, preferredSupplierId: central.id },
  });
  const ordem = await api<{ id: string; number: number }>('/work-orders', {
    token: oficina.token,
    payload: {
      customerId: oficina.clienteId,
      vehicleId: oficina.veiculoId,
      items: [
        { type: 'SERVICE', serviceId: oficina.servicoId },
        { type: 'PART', partId: disco.id, quantity: 2, unitPriceCents: 32000 },
      ],
    },
  });

  await entrarNoPainel(page, oficina.email);
  await page.goto(`/ordens/${ordem.number}`);
  await expect(page.getByText('Nenhuma cotação ainda.')).toBeVisible();
  await page.getByRole('button', { name: 'Cotar peças' }).click();

  const dialogo = page.getByRole('dialog', { name: 'Cotar peças com fornecedores' });
  // só a peça aparece (serviço não se cota), já marcada
  await expect(dialogo.getByRole('checkbox', { name: /Disco de freio ventilado/ })).toBeChecked();
  await expect(dialogo.getByText('Troca de pastilhas')).toHaveCount(0);
  // o preferido da peça vem marcado; o que vende a categoria aparece sugerido, sem marcar
  await expect(dialogo.getByRole('checkbox', { name: /Central Autopeças/ })).toBeChecked();
  await expect(dialogo.getByText('Preferido da peça')).toBeVisible();
  await expect(dialogo.getByText('Vende Freios')).toBeVisible();
  await expect(dialogo.getByRole('checkbox', { name: /Distribuidora Paulista/ })).not.toBeChecked();
  await dialogo.getByRole('checkbox', { name: /Distribuidora Paulista/ }).check();
  await expect(dialogo.getByText('2 de até 10')).toBeVisible();
  await dialogo.getByLabel('Recado para os fornecedores').fill('Carro parado, preciso para amanhã.');
  await captura(page, 'cotacao-01-pedido');
  await dialogo.getByRole('button', { name: 'Gerar links' }).click();

  // os links saem uma vez: WhatsApp para quem tem, copiar para quem não tem
  const criada = page.getByRole('dialog', { name: /Cotação nº 1 criada/ });
  await expect(criada.getByText('Os links aparecem só agora')).toBeVisible();
  await expect(criada.getByRole('link', { name: 'Enviar pelo WhatsApp' })).toHaveCount(1);
  await expect(criada.getByText('Sem WhatsApp cadastrado.')).toBeVisible();
  const whatsapp = await criada.getByRole('link', { name: 'Enviar pelo WhatsApp' }).getAttribute('href');
  expect(whatsapp).toMatch(/^https:\/\/wa\.me\/5511988887777\?text=/);
  const links = (await criada.locator('p.font-mono').allInnerTexts()).map((l) => l.replace('http://localhost:5173', BASE_URL));
  expect(links).toHaveLength(2);
  // a mensagem do WhatsApp não carrega a placa do cliente
  expect(decodeURIComponent(whatsapp ?? '')).not.toContain('COT1A23');
  await captura(page, 'cotacao-02-links');
  await criada.getByRole('link', { name: 'Ver quadro da cotação' }).click();

  await expect(page.getByRole('heading', { name: /Cotação nº 1/ })).toBeVisible();
  await expect(page.getByText('0 de 2 responderam')).toBeVisible();
  await expect(page.getByText('Nenhuma resposta para esta peça ainda.')).toBeVisible();

  // os dois respondem: a Central mais cara e mais rápida, a Distribuidora mais barata
  const [linkCentral, linkDistribuidora] = [links[0]!, links[1]!];
  await responder(linkCentral, 'Roberto', [21000], 0);
  await responder(linkDistribuidora, 'Márcia', [19500], 3);
  await page.reload();

  await expect(page.getByText('2 de 2 responderam')).toBeVisible();
  const ofertaCentral = page.getByRole('radio', { name: 'Escolher Central Autopeças para Disco de freio ventilado' });
  const ofertaDistribuidora = page.getByRole('radio', { name: 'Escolher Distribuidora Paulista para Disco de freio ventilado' });
  const linhaDistribuidora = page.locator('li').filter({ has: ofertaDistribuidora });
  await expect(linhaDistribuidora.getByText('Mais barata')).toBeVisible();
  await expect(page.locator('li').filter({ has: ofertaCentral }).getByText('Mais rápida')).toBeVisible();
  // 2 × R$ 195,00 = R$ 390,00; + frete R$ 15,00 = R$ 405,00
  expect(await textoDe(linhaDistribuidora)).toContain('R$ 195,00');
  expect(await textoDe(linhaDistribuidora)).toContain('R$ 390,00 no total');
  expect(await textoDe(page.locator('li').filter({ hasText: 'Márcia' }))).toMatch(/R\$ 390,00 \+ frete R\$ 15,00\s+R\$ 405,00/);
  await captura(page, 'cotacao-03-quadro');

  // o gerente escolhe a mais rápida (carro parado): confirma, e a cotação encerra
  await ofertaCentral.check();
  // a conta da margem aparece para decidir o preço de venda: R$ 210,00 + 30% = R$ 273,00
  expect(await textoDe(page.getByText(/preço sugerido é/))).toContain('margem de 30%, o preço sugerido é R$ 273,00 (hoje na OS: R$ 320,00)');
  await page.getByRole('button', { name: 'Salvar escolha' }).click();
  const confirmacao = page.getByRole('alertdialog', { name: 'Escolher e encerrar a cotação?' });
  await confirmacao.getByRole('button', { name: 'Escolher e encerrar' }).click();
  await expect(page.getByText(/Encerrada em/)).toBeVisible();
  await expect(page.locator('li').filter({ has: ofertaCentral }).getByText('Escolhida')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Salvar escolha' })).toHaveCount(0);
  await captura(page, 'cotacao-04-escolhida');

  // o quadro passa na auditoria automática
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(violations.map((v) => `${v.id} (${v.nodes.length}): ${v.help} ${v.nodes.map((n) => `${n.html} ${n.failureSummary}`).join(' / ')}`)).toEqual([]);

  // o custo da peça em rascunho virou o escolhido; o preço de venda não mudou
  const ficha = await api<{ items: { type: string; unitCostCents: number | null; unitPriceCents: number }[] }>(
    `/work-orders/${ordem.number}`,
    { token: oficina.token },
  );
  const peca = ficha.items.find((item) => item.type === 'PART')!;
  expect(peca.unitCostCents).toBe(21000);
  expect(peca.unitPriceCents).toBe(32000);

  // a trilha leva de volta à OS, onde a cotação aparece encerrada
  await page.getByRole('navigation', { name: 'Trilha de navegação' }).getByRole('link', { name: `OS ${ordem.number}` }).click();
  const naOS = page.getByRole('link', { name: /Cotação nº 1/ });
  await expect(naOS.getByText('Encerrada')).toBeVisible();
  await expect(naOS.getByText(/2 de 2 responderam/)).toBeVisible();
});
