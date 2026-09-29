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
 * Terminar a OS, e receber (E32/E33).
 *
 * O roteiro é a dúvida que o dono do produto teve usando: "como eu termino
 * isso?". A tela precisa responder sozinha — dizendo em que etapa a OS está,
 * o que falta, e qual dos botões é o próximo. E os DOIS finais não podem se
 * confundir: finalizar o serviço não é entregar o carro.
 */
test('a OS diz em que etapa está, qual é o próximo botão, e cobra no Pix', async ({ page }) => {
  const oficina = await criarOficina('terminar', 'TRM1A23');
  const ordem = await abrirOS(oficina);
  const orcamento = await enviarOrcamento(oficina, ordem.id);
  await api(`/quotes/${orcamento.id}/manual-decision`, {
    token: oficina.token,
    payload: { decision: 'APPROVED', channel: 'PHONE' },
  });

  await entrarNoPainel(page, oficina.email);

  await test.step('orçar está na aba que ABRE, não escondido atrás de outra', async () => {
    // uma OS sem orçamento: é o estado de quem acabou de lançar os itens.
    // Orçar é fluxo de SERVIÇO — passou uma versão na aba do dinheiro e sumiu
    // da vista justamente de quem abria a OS para orçar (D67)
    const nova = await abrirOS(oficina);
    await page.goto(`/ordens/${nova.number}`);
    await expect(page.getByRole('heading', { name: new RegExp(`^OS ${nova.number}`) })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Enviar orçamento', exact: true }),
      'sem clicar em aba nenhuma',
    ).toBeVisible();
    await captura(page, 'terminar-00-orcar');
  });

  await test.step('dá para executar sem orçamento, mas o sistema pergunta antes', async () => {
    // a oficina real faz serviço pequeno no combinado de boca; sem esta saída
    // a OS ficava PRESA em "aguardando orçamento" (E34)
    const combinada = await abrirOS(oficina);
    await page.goto(`/ordens/${combinada.number}`);
    await page.getByRole('button', { name: 'Executar sem orçamento', exact: true }).click();

    const confirmacao = page.getByRole('alertdialog');
    const texto = await textoDe(confirmacao);
    expect(texto, 'diz o risco com todas as letras').toContain('não aprovou nada por escrito');
    expect(texto, 'e que fica registrado').toContain('timeline');
    await captura(page, 'terminar-00b-pular');

    await confirmacao.getByRole('button', { name: 'Executar assim mesmo' }).click();
    await expect(page.locator('[aria-current="step"]')).toContainText('Execução');
    await expect(
      page.getByRole('button', { name: 'Iniciar execução', exact: true }),
      'e o caminho segue normal a partir daí',
    ).toBeVisible();
  });

  await page.goto(`/ordens/${ordem.number}`);

  await test.step('a trilha diz onde a OS está e o que falta', async () => {
    const trilha = page.getByRole('list', { name: 'Etapas da OS' });
    await expect(trilha).toBeVisible();
    await expect(page.locator('[aria-current="step"]')).toContainText('Execução');
    await expect(page.getByText('Aprovado. Pode começar o serviço.')).toBeVisible();
    await captura(page, 'terminar-01-aprovada');

    const auditoria = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(auditoria.violations.map((v) => `${v.id}: ${v.nodes.length}`), 'acessibilidade').toEqual([]);
  });

  await test.step('o próximo passo é o único botão cheio', async () => {
    const principal = page.getByRole('button', { name: 'Iniciar execução', exact: true });
    await expect(principal).toHaveClass(/bg-accent/);
    await expect(page.getByRole('button', { name: 'Cancelar OS', exact: true }), 'cancelar nunca é destaque')
      .not.toHaveClass(/bg-accent/);
    await principal.click();
  });

  await test.step('em execução, a frase manda finalizar o serviço', async () => {
    await expect(page.locator('[aria-current="step"]')).toContainText('Execução');
    await expect(page.getByText('quando o carro estiver pronto, finalize o serviço', { exact: false })).toBeVisible();
    const finalizar = page.getByRole('button', { name: 'Finalizar serviço', exact: true });
    await expect(finalizar, 'e é ele o botão cheio').toHaveClass(/bg-accent/);
    await finalizar.click();

    // finalizar tira peça do estoque e cria conta a receber: ninguém descobre
    // isso depois (E34)
    const confirmacao = page.getByRole('alertdialog');
    expect(await textoDe(confirmacao), 'avisa do estoque e do financeiro').toContain('saem do estoque');
    await confirmacao.getByRole('button', { name: 'Finalizar serviço' }).click();
  });

  await test.step('finalizado NÃO é entregue: a frase separa os dois finais', async () => {
    await expect(page.locator('[aria-current="step"]')).toContainText('Entrega');
    const aviso = await textoDe(page.locator('main'));
    expect(aviso, 'diz que falta receber').toContain('Falta receber');
    expect(aviso, 'e que falta entregar').toContain('entregar o veículo');
    await expect(page.getByRole('button', { name: 'Entregar veículo', exact: true })).toHaveClass(/bg-accent/);
    await captura(page, 'terminar-02-finalizada');
  });

  await test.step('sem chave Pix, a OS não inventa QR — ensina a cadastrar', async () => {
    await abrirAbaDaOS(page, 'Dinheiro');
    await page.getByRole('button', { name: 'Pix na hora', exact: true }).click();
    const dialogo = page.getByRole('dialog');
    await expect(dialogo.getByText('Falta cadastrar a')).toBeVisible();
    await expect(dialogo.getByRole('img', { name: /QR Code/ }), 'nada de código que não paga').toHaveCount(0);
    await captura(page, 'terminar-03-sem-chave');
    await page.keyboard.press('Escape');
  });

  await test.step('com a chave, sai o QR de verdade e o copia e cola', async () => {
    await page.goto('/configuracoes/oficina');
    await page.getByLabel('Chave Pix').fill('oficina@teste.local');
    await page.getByLabel('Chave Pix').blur();
    await expect(page.getByText('Chave Pix salva.')).toBeVisible();

    await page.goto(`/ordens/${ordem.number}`);
    await abrirAbaDaOS(page, 'Dinheiro');
    await page.getByRole('button', { name: 'Pix na hora', exact: true }).click();

    const dialogo = page.getByRole('dialog');
    await expect(dialogo.getByRole('img', { name: /QR Code do Pix/ })).toBeVisible();

    const codigo = (await dialogo.locator('code').innerText()).trim();
    expect(codigo, 'é um BR Code do Pix').toContain('br.gov.bcb.pix');
    expect(codigo, 'com a chave da oficina').toContain('oficina@teste.local');
    expect(codigo, 'e com os R$ 680 da OS já dentro').toContain('5406680.00');
    expect(codigo, 'fechado pelo CRC').toMatch(/6304[0-9A-F]{4}$/);

    expect(await textoDe(dialogo), 'e avisa que a baixa é na mão').toContain('não avisa o sistema');
    await captura(page, 'terminar-04-pix');
  });
});
