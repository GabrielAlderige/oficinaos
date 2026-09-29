import AxeBuilder from '@axe-core/playwright';
import { captura, criarOficina, entrarNoPainel, expect, test, textoDe } from './helpers';

/**
 * Confirmação de e-mail no cadastro (E29).
 *
 * O roteiro é o de quem acabou de se cadastrar: o painel avisa que falta
 * confirmar, o aviso não bloqueia nada, e o link do e-mail confirma de uma vez.
 * O token vem do próprio painel — em teste o e-mail não sai de verdade, então
 * a página de confirmação é exercitada com um link inválido, que é o caso que
 * mais acontece na vida real (link velho, já usado).
 */
test('o painel avisa que falta confirmar o e-mail, sem travar o trabalho', async ({ page, ignorarErros }) => {
  // o último passo abre um link inválido de propósito: o 400 é o cenário
  ignorarErros.push(/status of 400/);
  const oficina = await criarOficina('confirmar', 'CFM1A23');
  await entrarNoPainel(page, oficina.email);

  await test.step('o aviso aparece no topo e não bloqueia nada', async () => {
    await expect(page.getByText('Falta confirmar seu e-mail.')).toBeVisible();
    const tela = await textoDe(page.locator('main'));
    expect(tela, 'o aviso diz para onde o link foi').toContain(oficina.email);
    expect(tela, 'e por que isso importa').toContain('recupera a senha');
    await captura(page, 'confirmar-01-aviso');

    // o sistema continua inteiro: o aviso é aviso, não porta fechada
    await page.getByRole('link', { name: 'Clientes' }).click();
    await expect(page.getByRole('heading', { name: 'Clientes' })).toBeVisible();

    const auditoria = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(auditoria.violations.map((v) => `${v.id}: ${v.nodes.length}`), 'acessibilidade').toEqual([]);
  });

  await test.step('o reenvio manda um link novo', async () => {
    await page.getByRole('button', { name: 'Reenviar link' }).click();
    await expect(page.getByText(`Link novo enviado para ${oficina.email}.`)).toBeVisible();
    await expect(page.getByText('Falta confirmar seu e-mail.'), 'o aviso sai de cena').toBeHidden();
    await captura(page, 'confirmar-02-reenviado');
  });

  await test.step('link vencido explica o que fazer, em vez de dar erro seco', async () => {
    await page.goto(`/confirmar-email/${'z'.repeat(43)}`);
    await expect(page.getByRole('heading', { name: 'Não deu para confirmar' })).toBeVisible();
    const tela = await textoDe(page.locator('body'));
    expect(tela, 'e diz onde pedir outro').toContain('aviso no topo do painel');
    await captura(page, 'confirmar-03-link-vencido');
  });
});
