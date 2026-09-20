import AxeBuilder from '@axe-core/playwright';
import { createHash } from 'node:crypto';
import { abrirOS, api, captura, criarOficina, entrarNoPainel, enviarOrcamento, expect, test, textoDe, type Oficina } from './helpers';

/**
 * Cobrança online (E19). O que este roteiro prova no navegador:
 * a OS finalizada oferece cobrar o saldo, a cobrança criada aparece com o
 * código para o cliente, o aviso do gateway dá baixa sozinho no caixa da OS —
 * e tudo sai marcado como **simulação**, porque não existe gateway contratado.
 */
async function osFinalizada(oficina: Oficina) {
  const ordem = await abrirOS(oficina);
  const orcamento = await enviarOrcamento(oficina, ordem.id);
  await api(`/quotes/${orcamento.id}/manual-decision`, {
    token: oficina.token,
    payload: { decision: 'APPROVED', channel: 'PHONE', signerName: 'João Pereira' },
  });
  await api(`/work-orders/${ordem.id}/start`, { token: oficina.token, payload: {} });
  await api(`/work-orders/${ordem.id}/complete`, { token: oficina.token, payload: {} });
  return ordem;
}

test('a oficina cobra o saldo por Pix e o aviso do gateway dá baixa sozinho', async ({ page }) => {
  const oficina = await criarOficina('cobranca', 'COB1A23');
  const ordem = await osFinalizada(oficina);

  await entrarNoPainel(page, oficina.email);
  await page.goto(`/ordens/${ordem.number}`);
  await expect(page.getByRole('heading', { name: new RegExp(`^OS ${ordem.number}`) })).toBeVisible();

  await test.step('a OS oferece cobrar exatamente o que falta', async () => {
    // a aprovação por telefone aprovou tudo: serviço (R$ 180) + 2 peças (R$ 500)
    await expect(page.getByRole('button', { name: /Cobrar R\$\s?680,00/ })).toBeVisible();
    await captura(page, 'cobranca-01-cartao');
  });

  await test.step('criar a cobrança mostra o código para o cliente', async () => {
    await page.getByRole('button', { name: /Cobrar R\$\s?680,00/ }).click();
    const dialogo = page.getByRole('dialog');
    await expect(dialogo.getByLabel('Como cobrar')).toBeVisible();
    await expect(dialogo.getByLabel('Valor')).toHaveValue('680,00');
    await captura(page, 'cobranca-02-nova');
    await dialogo.getByRole('button', { name: 'Criar cobrança' }).click();
    await expect(page.getByText('Cobrança criada.')).toBeVisible();

    await expect(page.getByText('Aguardando pagamento')).toBeVisible();
    const cartao = await textoDe(page.locator('main'));
    expect(cartao, 'o "copia e cola" sai declarado como simulação').toContain('SIMULACAO');
    expect(cartao, 'e a tela avisa que nada foi cobrado de verdade').toContain('Modo simulação');
    await captura(page, 'cobranca-03-pendente');
  });

  await test.step('o aviso do gateway dá baixa no caixa da OS', async () => {
    // o simulador deriva a referência do id da cobrança
    const resumo = await api<{ charges: { id: string }[] }>(`/work-orders/${ordem.id}/charges`, {
      token: oficina.token,
    });
    const ref = `sim-${createHash('sha256').update(resumo.charges[0]!.id).digest('hex').slice(0, 16)}`;
    await api('/webhooks/payments/simulador', {
      payload: { event: 'PAYMENT_RECEIVED', providerChargeId: ref, amountCents: 68_000, externalId: `evt-${ref}` },
    });

    await page.reload();
    await expect(page.getByText('Pago', { exact: true }).first()).toBeVisible();
    const cartao = await textoDe(page.locator('main'));
    expect(cartao, 'o caixa da OS recebeu o dinheiro').toContain('Recebido');
    expect(cartao, 'e a OS ficou paga').toContain('R$ 680,00');
    await captura(page, 'cobranca-04-paga');

    const auditoria = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(auditoria.violations.map((v) => `${v.id}: ${v.nodes.length}`), 'acessibilidade').toEqual([]);
  });
});
