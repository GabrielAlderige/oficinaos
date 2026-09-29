import AxeBuilder from '@axe-core/playwright';
import {
  apagarFichaDoCatalogo,
  captura,
  abrirOS,
  criarOficina,
  entrarNoPainel,
  expect,
  marcarAdminDaPlataforma,
  test,
  textoDe,
} from './helpers';

/**
 * Ficha do carro (E31).
 *
 * O roteiro é o dos dois lados: a oficina procura um carro que ainda não
 * existe e é avisada com honestidade (em desenvolvimento, e dá para pedir);
 * a plataforma preenche e publica; a oficina volta e acha.
 *
 * O que precisa ficar provado é justamente a honestidade: rascunho não vaza,
 * e o que não existe não é maquiado.
 */
test('a oficina pede um carro, a plataforma preenche e a ficha aparece', async ({ page }) => {
  // o catálogo é GLOBAL: não dá para supor que está vazio nem que ninguém mais
  // mexeu nele. O cenário trabalha num modelo só dele.
  const modelo = `Gol T${Date.now().toString(36).slice(-5)}`;
  const busca = encodeURIComponent(modelo);
  // o catálogo é GLOBAL: o que este cenário publicar fica visível para toda
  // oficina até alguém apagar. Ele recolhe a própria ficha no fim
  const oficina = await criarOficina('ficha', 'FCH1A23');
  // a marca de administrador é lida no LOGIN e fica em cache na sessão: tem de
  // existir antes de entrar, senão a área da plataforma só abre no próximo login
  await marcarAdminDaPlataforma(oficina.email);
  await entrarNoPainel(page, oficina.email);

  await test.step('carro que não está no catálogo avisa, e não inventa', async () => {
    await page.goto('/ficha-do-carro');
    await page.getByLabel('Buscar carro na ficha').fill(modelo);

    await expect(page.getByText('ainda está em desenvolvimento')).toBeVisible();
    const tela = await textoDe(page.locator('main'));
    expect(tela, 'nada de óleo inventado').not.toContain('5W30');
    await captura(page, 'ficha-01-em-desenvolvimento');

    const auditoria = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(auditoria.violations.map((v) => `${v.id}: ${v.nodes.length}`), 'acessibilidade').toEqual([]);
  });

  await test.step('a oficina pede o carro', async () => {
    await page.getByRole('button', { name: 'Pedir este carro' }).click();
    await page.getByLabel('Marca').fill('Volkswagen');
    await page.getByLabel('Modelo').fill(modelo);
    await page.getByLabel('Ano').fill('2013');
    await page.getByRole('button', { name: 'Pedir carro' }).click();
    await expect(page.getByText('Anotado. Os carros mais pedidos')).toBeVisible();
    await captura(page, 'ficha-02-pedido');
  });

  await test.step('a plataforma vê o pedido e preenche a ficha', async () => {
    await page.goto('/plataforma/catalogo');
    await expect(page.getByRole('heading', { name: 'Catálogo de veículos' })).toBeVisible();
    // a fila chega por consulta própria: esperar o texto, e não ler a tela crua
    await expect(
      page.getByText(`Volkswagen ${modelo} 2013`),
      'o pedido da oficina virou fila de quem preenche',
    ).toBeVisible();

    await page.getByRole('button', { name: 'Novo carro' }).click();
    await page.getByRole('textbox', { name: 'Marca', exact: true }).fill('Volkswagen');
    await page.getByRole('textbox', { name: 'Modelo', exact: true }).fill(modelo);
    await page.getByRole('textbox', { name: 'Versão / motor' }).fill('G6 1.0 8V');
    await page.getByRole('textbox', { name: 'Ano inicial' }).fill('2013');
    await page.getByRole('textbox', { name: 'Ano final' }).fill('2016');
    await page.getByRole('textbox', { name: 'Óleo do motor' }).fill('5W30 sintético · 3,5 L');
    await page.getByRole('textbox', { name: 'Pastilha dianteira' }).fill('Cobreq N-1234');
    await captura(page, 'ficha-03-preenchendo');

    // rascunho primeiro: é o estado normal de quem está montando a ficha
    await page.getByRole('button', { name: 'Salvar rascunho' }).click();
    await expect(page.getByText('Rascunho salvo.')).toBeVisible();
  });

  await test.step('rascunho NÃO aparece para a oficina', async () => {
    await page.goto(`/ficha-do-carro?q=${busca}`);
    await expect(page.getByText('ainda está em desenvolvimento'), 'meia ficha é pior que ficha nenhuma').toBeVisible();
  });

  await test.step('publicada, a oficina acha e lê a especificação', async () => {
    await page.goto('/plataforma/catalogo');
    await page.getByLabel('Buscar no catálogo').fill(modelo);
    // a busca tem espera: sem isto o clique pega o primeiro cartão da lista
    // AINDA não filtrada, e publica a ficha de outro carro
    const cartao = page.getByRole('button', { name: new RegExp(modelo) });
    await expect(cartao).toBeVisible();
    await cartao.click();
    await page.getByRole('button', { name: 'Publicar' }).click();
    await expect(page.getByText('Ficha publicada')).toBeVisible();

    await page.goto(`/ficha-do-carro?q=${busca}`);
    await expect(page.getByText(`Volkswagen ${modelo} · G6 1.0 8V · 2013–2016`)).toBeVisible();
    expect(await textoDe(page.locator('main')), 'a tela diz quantos carros existem').toMatch(/carros? dispon/);

    await page.getByRole('button', { name: /Ver ficha/ }).click();
    const ficha = await textoDe(page.getByRole('dialog'));
    expect(ficha, 'o óleo que a plataforma escreveu').toContain('5W30 sintético · 3,5 L');
    expect(ficha, 'e o aviso de conferir a embalagem').toContain('Confira sempre a embalagem');
    await captura(page, 'ficha-04-publicada');
  });

  await test.step('a pesquisa tem aba própria, e o mecânico chega nela', async () => {
    // antes era a terceira aba dentro de "Peças e estoque": três toques para
    // uma consulta feita com a peça na mão (E36)
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Ficha do carro', exact: true })).toBeVisible();

    // o endereço antigo continua chegando, e com o que estava pesquisado
    await page.goto(`/pecas/ficha-do-carro?q=${busca}`);
    await expect(page).toHaveURL(/\/ficha-do-carro\?q=/);
    await expect(page.getByLabel('Buscar carro na ficha')).toHaveValue(modelo);
  });

  await test.step('dentro da OS dá para consultar a ficha de QUALQUER carro', async () => {
    // a pergunta "que óleo entra nesse?" nasce com a OS aberta. Mandar o
    // mecânico para outra tela faz ele perder o que estava fazendo, então a
    // busca inteira mora num diálogo — e não é presa ao carro da OS (E37)
    const ordem = await abrirOS(oficina);
    await page.goto(`/ordens/${ordem.number}`);

    await page.getByRole('button', { name: 'Consultar ficha do carro' }).click();
    const dialogo = page.getByRole('dialog');
    // o veículo da oficina de teste é um Volkswagen Gol
    await expect(
      dialogo.getByLabel('Buscar carro na ficha'),
      'o diálogo abre com o carro DESTA OS já escrito',
    ).toHaveValue('Volkswagen Gol');

    // apaga o carro da OS e procura outro: é o caso do carro do lado no elevador
    await dialogo.getByLabel('Buscar carro na ficha').fill(modelo);
    // "Gol" casa com meia dúzia de fichas: o cartão certo é o do modelo deste
    // cenário, e esperar por ele também espera a busca com atraso terminar
    const cartaoNaOS = dialogo.getByRole('button', { name: new RegExp(modelo) });
    await expect(cartaoNaOS).toBeVisible();
    await cartaoNaOS.click();
    const ficha = await textoDe(dialogo);
    expect(ficha, 'a ficha do outro carro abre sem sair da OS').toContain('5W30 sintético · 3,5 L');
    await captura(page, 'ficha-05-dentro-da-os');
  });

  await apagarFichaDoCatalogo(modelo);
});
