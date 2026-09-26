import AxeBuilder from '@axe-core/playwright';
import { captura, criarOficina, entrarNoPainel, expect, test, textoDe } from './helpers';

/**
 * Conversa pelo OficinaOS (E22).
 *
 * O que este roteiro prova no navegador: a oficina abre a conversa do cliente,
 * lê o texto pronto do pós-venda **antes** de mandar, e a mensagem só sai
 * quando alguém aperta o botão. Sem conta conectada na Meta — que é o estado de
 * quem ainda não configurou nada — a mensagem sai pelo link do WhatsApp, com o
 * texto pronto, e fica registrada no histórico.
 *
 * A tela de configuração é conferida aqui também: é onde a oficina descobre o
 * que precisa fazer na Meta, e o que ela ganha (e o que ela perde) ao conectar.
 */
test('a oficina conversa com o cliente pelo sistema e manda o pós-venda no botão', async ({ page }) => {
  const oficina = await criarOficina('conversa', 'CNV1A23');
  await entrarNoPainel(page, oficina.email);

  await test.step('as configurações explicam o WhatsApp oficial sem enganar ninguém', async () => {
    await page.goto('/configuracoes/whatsapp');
    await expect(page.getByRole('heading', { name: 'O WhatsApp da sua oficina' })).toBeVisible();

    const tela = await textoDe(page.locator('main'));
    expect(tela, 'quem não conectou nada precisa ler que já funciona').toContain('já funcionam sem isto');
    // o endereço e o token moram em campos: valor de input não entra no innerText
    await expect(page.getByRole('textbox', { name: 'URL de callback' })).toHaveValue(
      /\/api\/v1\/webhooks\/whatsapp\//,
    );
    await expect(page.getByRole('textbox', { name: 'Token de verificação' })).not.toHaveValue('');
    expect(tela, 'o texto para colar na Meta vem com as variáveis').toContain('{{1}}');
    expect(tela, 'a regra do automático fica dita').toContain('nunca');
    await captura(page, 'conversas-01-configuracao');

    const auditoria = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(auditoria.violations.map((v) => `${v.id}: ${v.nodes.length}`), 'acessibilidade').toEqual([]);
  });

  await test.step('o pós-venda não pode ser automático; "veículo pronto" pode', async () => {
    const automaticos = page.getByRole('listitem').filter({ hasText: 'Veículo pronto' });
    await expect(automaticos.first()).toBeVisible();
    // o pós-venda nem aparece na lista do que sai sozinho
    await expect(
      page.locator('section', { hasText: 'Enviar sozinho' }).getByText('Pós-venda (7 dias)'),
    ).toHaveCount(0);
  });

  await test.step('a conversa começa pelo cliente e ainda não tem mensagem nenhuma', async () => {
    await page.goto(`/clientes/${oficina.clienteId}`);
    await page.getByRole('link', { name: 'Conversar' }).click();
    await expect(page.getByRole('heading', { name: 'Conversas' })).toBeVisible();
    await expect(page.getByText('Nenhuma mensagem com este cliente ainda.')).toBeVisible();
    await expect(page.getByText(/saem pelo link/)).toBeVisible();
    await captura(page, 'conversas-02-vazia');
  });

  await test.step('as respostas prontas escrevem no campo, agrupadas pela etapa', async () => {
    await page.getByRole('button', { name: 'Respostas prontas' }).click();
    await expect(page.getByRole('group', { name: 'Etapa do atendimento' })).toBeVisible();
    await captura(page, 'conversas-03-respostas-prontas');

    await page.getByRole('button', { name: 'Retirada' }).click();
    await page.getByRole('button', { name: /Carro pronto/ }).click();

    const campo = page.getByRole('textbox', { name: 'Mensagem' });
    await expect(campo, 'a resposta pronta escreve no campo, e não sai sozinha').toHaveValue(
      'Seu Volkswagen Gol está pronto para retirada.',
    );
    // a pessoa pode ajustar antes de mandar: é esse o ponto
    await campo.fill('Seu Volkswagen Gol está pronto para retirada. Pode buscar hoje?');
    await captura(page, 'conversas-04-preenchido');

    const auditoria = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(auditoria.violations.map((v) => `${v.id}: ${v.nodes.length}`), 'acessibilidade').toEqual([]);
  });

  await test.step('escrever e mandar: sem canal conectado, sai pelo link', async () => {
    // o link do WhatsApp abre em outra aba: o teste pega a aba nova e fecha
    const [aba] = await Promise.all([
      page.context().waitForEvent('page'),
      page.getByRole('button', { name: 'Enviar mensagem' }).click(),
    ]);
    // o wa.me redireciona para api.whatsapp.com e troca espaço por "+": o que
    // interessa é o número e o texto, então a leitura desfaz as duas coisas
    const link = decodeURIComponent(aba.url().replace(/\+/g, ' '));
    expect(link, 'o texto vai pronto para o WhatsApp').toContain('5511912345678');
    expect(link).toContain('Pode buscar hoje?');
    await aba.close();

    const fio = await textoDe(page.getByRole('list', { name: /Mensagens com/ }));
    expect(fio, 'a mensagem enviada fica registrada').toContain('Pode buscar hoje?');
    expect(fio, 'com o dia e a hora').toContain('Hoje');
  });

  await test.step('o modelo de pós-venda aparece escrito, e sai no botão', async () => {
    await page.getByRole('button', { name: 'Modelos' }).click();
    await page.getByRole('button', { name: 'Pós-venda' }).click();
    const texto = await textoDe(page.getByRole('group', { name: 'Mensagem pronta: Pós-venda' }));
    expect(texto).toContain('João');
    expect(texto).toContain('Volkswagen Gol');
    expect(texto).toContain('CNV1A23');
    await captura(page, 'conversas-05-modelo-pronto');

    const [aba] = await Promise.all([
      page.context().waitForEvent('page'),
      page.getByRole('button', { name: 'Enviar esta mensagem' }).click(),
    ]);
    expect(decodeURIComponent(aba.url().replace(/\+/g, ' '))).toContain('como ficou o serviço');
    await aba.close();

    await expect(page.getByText('link aberto').first(), 'sem a API oficial, é o máximo que se sabe').toBeVisible();
    expect(await textoDe(page.getByRole('list', { name: /Mensagens com/ })), 'as duas ficam no fio').toContain(
      'como ficou o serviço',
    );
    await captura(page, 'conversas-06-enviada');
  });

  await test.step('a conversa entra na lista, com o começo da mensagem', async () => {
    await page.reload();
    const lista = await textoDe(page.getByRole('list', { name: 'Conversas' }));
    expect(lista).toContain('João Pereira');
    expect(lista).toContain('Você:');
    await captura(page, 'conversas-07-lista');
  });
});
