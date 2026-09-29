import AxeBuilder from '@axe-core/playwright';
import { api, captura, criarMecanico, criarOficina, entrarNoPainel, expect, test, textoDe } from './helpers';

/**
 * Comissão do mecânico (E26).
 *
 * O roteiro é a conversa do fim do mês: a oficina configura o percentual, o
 * serviço é feito, o cliente paga metade — e a tela mostra metade da comissão,
 * com a OS que gerou cada real. Só depois disso o pagamento é registrado.
 */
test('a oficina configura a comissão, acompanha e paga o mecânico', async ({ page }) => {
  const oficina = await criarOficina('comissao', 'CMS1A23');
  const mecanico = await criarMecanico(oficina, 'Zé Mecânico');

  await entrarNoPainel(page, oficina.email);

  await test.step('o percentual padrão fica em Preços e estoque', async () => {
    await page.goto('/configuracoes/precos');
    await page.getByLabel('Comissão padrão do mecânico').fill('10');
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByText('Preços salvos.')).toBeVisible();
    await captura(page, 'comissao-01-configuracao');
  });

  // uma OS de R$ 180 de mão de obra, finalizada com o Zé como responsável
  const ordem = await api<{ id: string; number: number }>('/work-orders', {
    token: oficina.token,
    payload: {
      customerId: oficina.clienteId,
      vehicleId: oficina.veiculoId,
      mechanicUserId: mecanico.userId,
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

  await test.step('sem o cliente pagar, a comissão aparece como ainda não ganha', async () => {
    await page.goto('/financeiro/comissoes');
    await expect(page.getByRole('heading', { name: 'Comissões' })).toBeVisible();
    await expect(page.getByText('Zé Mecânico')).toBeVisible();

    const tela = await textoDe(page.locator('main'));
    expect(tela, 'a comissão cheia seria R$ 18,00 (10% de R$ 180)').toContain('R$ 18,00');
    expect(tela, 'mas nada foi ganho ainda').toContain('R$ 0,00');
    await captura(page, 'comissao-02-nada-ganho');
  });

  await test.step('o cliente paga metade, e metade da comissão é ganha', async () => {
    await api(`/work-orders/${ordem.id}/payments`, {
      token: oficina.token,
      payload: { clientRequestId: crypto.randomUUID(), method: 'PIX', amountCents: 9_000 },
    });

    await page.reload();
    await page.getByRole('button', { name: 'Ver as OS' }).click();
    const tela = await textoDe(page.locator('main'));
    expect(tela, 'metade de R$ 18,00').toContain('R$ 9,00');
    expect(tela, 'e a OS que gerou a comissão está na lista').toContain(`OS ${ordem.number}`);
    await captura(page, 'comissao-03-metade');

    const auditoria = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(auditoria.violations.map((v) => `${v.id}: ${v.nodes.length}`), 'acessibilidade').toEqual([]);
  });

  await test.step('o pagamento ao mecânico fica registrado, sem mexer no cálculo', async () => {
    await page.getByRole('button', { name: 'Registrar pagamento' }).click();
    const dialogo = page.getByRole('dialog');
    await expect(dialogo.getByLabel('Valor pago')).toHaveValue('9,00');
    await dialogo.getByLabel('Observação').fill('Pago em dinheiro');
    await captura(page, 'comissao-04-pagamento');
    await dialogo.getByRole('button', { name: 'Registrar pagamento' }).click();

    await expect(page.getByText('Comissão de Zé Mecânico registrada.')).toBeVisible();
    const tela = await textoDe(page.locator('main'));
    expect(tela, 'o que foi pago aparece ao lado do que foi ganho').toContain('pago R$ 9,00');
  });
});
