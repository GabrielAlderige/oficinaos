import { api, captura, criarOficina, entrarNoPainel, expect, test, textoDe } from './helpers';

/**
 * Plataforma (E17): a oficina que chega de outro sistema traz a planilha, e o
 * cliente acompanha o carro por link — sem ligar para o balcão.
 */
test('a oficina importa a planilha e o cliente acompanha o carro pelo link', async ({ page }) => {
  const oficina = await criarOficina('plataforma', 'PLT5X54');
  await entrarNoPainel(page, oficina.email);

  await test.step('a importação confere antes de gravar', async () => {
    await page.goto('/configuracoes/importar');
    await expect(page.getByRole('heading', { name: 'Importar planilha' })).toBeVisible();

    await page.getByLabel('Arquivo CSV').setInputFiles({
      name: 'clientes.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        [
          'nome;whatsapp;documento',
          'Marcos Vieira;(11) 97777-6666;529.982.247-25',
          'Tatiane Alves;(11) 96666-5555;',
          ';(11) 90000-0000;',
        ].join('\n'),
        'utf-8',
      ),
    });
    await page.getByRole('button', { name: 'Conferir' }).click();
    await expect(page.getByRole('heading', { name: 'Conferência (nada foi gravado)' })).toBeVisible();
    const conferencia = await textoDe(page.locator('main'));
    expect(conferencia, 'dois entram, um é recusado').toContain('Serão criados');
    expect(conferencia).toContain('linha 4: sem nome');
    await captura(page, 'plataforma-01-conferencia');

    // conferir NÃO grava: a lista de clientes continua vazia
    await page.goto('/clientes');
    await expect(page.getByText('Marcos Vieira')).toHaveCount(0);

    await page.goto('/configuracoes/importar');
    await page.getByLabel('Arquivo CSV').setInputFiles({
      name: 'clientes.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('nome;whatsapp\nMarcos Vieira;(11) 97777-6666', 'utf-8'),
    });
    await page.getByRole('button', { name: 'Conferir' }).click();
    await expect(page.getByRole('heading', { name: 'Conferência (nada foi gravado)' })).toBeVisible();
    await page.getByRole('button', { name: 'Importar de verdade' }).click();
    await expect(page.getByRole('heading', { name: 'Importação concluída' })).toBeVisible();

    await page.goto('/clientes?q=Marcos');
    await expect(page.getByText('Marcos Vieira')).toBeVisible();
  });

  await test.step('o cliente acompanha o carro pelo link, sem login', async () => {
    const ordem = await api<{ id: string; number: number }>('/work-orders', {
      token: oficina.token,
      payload: {
        customerId: oficina.clienteId,
        vehicleId: oficina.veiculoId,
        items: [{ type: 'SERVICE', serviceId: oficina.servicoId }],
      },
    });

    await page.goto(`/ordens/${ordem.number}`);
    await expect(page.getByRole('button', { name: 'Link de acompanhamento' })).toBeVisible();

    const link = await api<{ publicUrl: string }>(`/work-orders/${ordem.id}/tracking-link`, {
      token: oficina.token,
      payload: {},
    });
    const token = link.publicUrl.slice(link.publicUrl.lastIndexOf('/') + 1);

    const celular = await page.context().newPage();
    await celular.setViewportSize({ width: 390, height: 844 });
    await celular.goto(`/acompanhar/${token}`);
    await expect(celular.getByText('Carro recebido')).toBeVisible();
    const tela = await textoDe(celular.locator('main'));
    expect(tela, 'a frase é escrita para o cliente').toContain('Recebemos seu carro');
    expect(tela).toContain(`OS nº ${ordem.number}`);
    expect(tela, 'sem custo de peça na página pública').not.toContain('custo');
    await celular.screenshot({ path: 'e2e/screenshots/plataforma-02-acompanhar.png', fullPage: true });
    await celular.close();
  });
});
