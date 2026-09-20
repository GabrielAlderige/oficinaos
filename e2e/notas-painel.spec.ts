import AxeBuilder from '@axe-core/playwright';
import { abrirOS, api, captura, criarOficina, entrarNoPainel, enviarOrcamento, expect, test, textoDe, type Oficina } from './helpers';

/**
 * Nota fiscal de serviço (E18). O que este roteiro prova no navegador:
 * a OS finalizada oferece emitir a nota, a tela mostra os números antes de
 * mandar, o que falta aparece com o caminho para resolver, e a nota emitida
 * fica marcada como **simulação** — porque o emissor de verdade ainda não
 * está contratado, e nota falsa não pode parecer nota de verdade.
 */
const DADOS_FISCAIS = {
  municipalRegistration: '123456',
  taxRegime: 'SIMPLES_NACIONAL',
  serviceListItem: '14.01',
  issRateBps: 500,
};

const ENDERECO = {
  zip: '01310-100',
  street: 'Avenida Paulista',
  number: '1000',
  complement: '',
  district: 'Bela Vista',
  city: 'São Paulo',
  state: 'SP',
};

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

test('a oficina completa os dados fiscais, emite a nota do serviço e cancela a que saiu errada', async ({ page }) => {
  const oficina = await criarOficina('nota', 'NFE1A23');
  const ordem = await osFinalizada(oficina);

  await entrarNoPainel(page, oficina.email);

  await test.step('sem dado fiscal, a tela diz o que falta e onde resolver', async () => {
    await page.goto(`/ordens/${ordem.number}`);
    await expect(page.getByRole('heading', { name: new RegExp(`^OS ${ordem.number}`) })).toBeVisible();
    await page.getByRole('button', { name: 'Emitir nota' }).click();

    const dialogo = page.getByRole('dialog');
    await expect(dialogo.getByText('Falta preencher para conseguir emitir:')).toBeVisible();
    await expect(dialogo.getByText(/inscrição municipal/i)).toBeVisible();
    await expect(dialogo.getByRole('button', { name: 'Emitir nota' })).toBeDisabled();
    await captura(page, 'nota-01-pendencias');
    await page.keyboard.press('Escape');
  });

  await test.step('os dados fiscais ficam nas configurações', async () => {
    await page.goto('/configuracoes/fiscal');
    await expect(page.getByRole('heading', { name: 'Dados para a nota de serviço' })).toBeVisible();
    await expect(page.getByText(/Emissor em modo simulação/)).toBeVisible();
    await page.getByLabel('Inscrição municipal').fill(DADOS_FISCAIS.municipalRegistration);
    await page.getByLabel('Regime tributário').selectOption('SIMPLES_NACIONAL');
    await page.getByLabel('Item da lista de serviços').fill(DADOS_FISCAIS.serviceListItem);
    await page.getByLabel('Alíquota de ISS').fill('5');
    await page.getByRole('button', { name: 'Salvar dados fiscais' }).click();
    await expect(page.getByText('Dados fiscais salvos.')).toBeVisible();
    await captura(page, 'nota-02-configuracao');

    // o resto dos dados da oficina e do cliente entra pela API: o que importa
    // aqui é a tela fiscal, e os dois cadastros já têm teste próprio
    await api('/organization', {
      method: 'PATCH',
      token: oficina.token,
      payload: { legalName: 'Oficina Teste LTDA', document: '11.222.333/0001-81', address: ENDERECO },
    });
    await api(`/customers/${oficina.clienteId}`, {
      method: 'PATCH',
      token: oficina.token,
      payload: { address: { ...ENDERECO, street: 'Rua das Flores', number: '25' } },
    });
  });

  await test.step('a nota sai com o ISS por dentro e a peça de fora', async () => {
    await page.goto(`/ordens/${ordem.number}`);
    await page.getByRole('button', { name: 'Emitir nota' }).click();
    const dialogo = page.getByRole('dialog');
    await expect(dialogo.getByText('Falta preencher para conseguir emitir:')).toBeHidden();

    const conferencia = await textoDe(dialogo);
    expect(conferencia, 'o serviço da OS').toContain('R$ 180,00');
    expect(conferencia, '5% de 180').toContain('R$ 9,00');
    expect(conferencia, 'a peça fica de fora e a tela avisa').toContain('não entram');
    expect(conferencia, 'simulação declarada').toContain('Modo simulação');
    await captura(page, 'nota-03-conferencia');

    await dialogo.getByRole('button', { name: 'Emitir nota' }).click();
    await expect(page.getByText(/Nota .* emitida/)).toBeVisible();

    // o cartão da OS rebusca depois do toast: ler a tela antes disso pega o
    // estado velho (leitura única não tem retry, `expect(locator)` tem)
    await expect(page.getByText('Autorizada')).toBeVisible();
    const cartao = await textoDe(page.locator('main'));
    expect(cartao).toContain('Autorizada');
    expect(cartao, 'nada de nota simulada passando por real').toContain('Simulação');
  });

  await test.step('a lista de notas mostra o ISS e deixa cancelar com motivo', async () => {
    await page.getByRole('link', { name: 'Notas fiscais' }).first().click();
    await expect(page.getByRole('heading', { name: 'Notas fiscais' })).toBeVisible();
    await expect(page.getByRole('cell', { name: `OS nº ${ordem.number}` })).toBeVisible();
    const lista = await textoDe(page.locator('main'));
    expect(lista, 'ISS da nota').toContain('R$ 9,00');
    await captura(page, 'nota-04-lista');

    const auditoria = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(auditoria.violations.map((v) => `${v.id}: ${v.nodes.length}`), 'acessibilidade').toEqual([]);

    await page.getByRole('button', { name: /^\d+$/ }).first().click();
    const ficha = page.getByRole('dialog');
    await ficha.getByLabel('Motivo do cancelamento').fill('Valor errado na nota');
    await ficha.getByRole('button', { name: 'Cancelar nota' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Cancelar nota' }).click();
    await expect(page.getByText('Nota cancelada.')).toBeVisible();
    await captura(page, 'nota-05-cancelada');
  });
});
