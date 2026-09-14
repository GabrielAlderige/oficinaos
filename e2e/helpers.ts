import { expect, test as base, type Locator, type Page } from '@playwright/test';

export const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const API = `${BASE_URL}/api/v1`;
export const SENHA = 'cavalo-correto-bateria-grampo';

/**
 * Chamada direta à API para montar o cenário. Passo de navegador é caro e
 * frágil: o que a tela precisa provar é o fluxo do orçamento, não o cadastro.
 */
export async function api<T>(path: string, options: { payload?: unknown; token?: string } = {}): Promise<T> {
  const { payload, token } = options;
  const metodo = payload === undefined ? 'GET' : 'POST';
  const response = await fetch(`${API}${path}`, {
    method: metodo,
    headers: {
      'content-type': 'application/json',
      // rotas com cookie de sessão exigem Origin da lista do CORS (o painel sempre manda)
      origin: BASE_URL,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const corpo = await response.text();
  if (!response.ok) throw new Error(`${metodo} ${path} devolveu ${response.status}: ${corpo}`);
  return (corpo ? JSON.parse(corpo) : undefined) as T;
}

/**
 * O Intl gera espaço INQUEBRÁVEL em "R$ 680,00" e nas datas. Sem trocar por
 * espaço comum, a comparação falha por um caractere invisível — já custou uma
 * rodada. Os escapes ficam explícitos de propósito: NBSP digitado literalmente
 * vira espaço comum ao salvar o arquivo, e a regex viraria um no-op silencioso.
 */
export const semEspacoEstranho = (valor: string) => valor.replace(/[\u00a0\u202f\u2009]/g, ' ');

export const textoDe = async (locator: Locator) => semEspacoEstranho(await locator.innerText());

/** Captura para conferência humana (claro, escuro, celular). Fora do git. */
export async function captura(page: Page, nome: string): Promise<void> {
  await page.waitForTimeout(300);
  await page.screenshot({ path: `e2e/screenshots/${nome}.png`, fullPage: true });
}

export interface Oficina {
  token: string;
  email: string;
  servicoId: string;
  pecaId: string;
  clienteId: string;
  veiculoId: string;
}

export interface OrdemDeServico {
  id: string;
  number: number;
}

export interface OrcamentoEnviado {
  id: string;
  number: number;
  publicUrl: string;
}

interface ItemDaOS {
  type: string;
  stockStatus: string;
  reservedQuantity: number | string;
}

export interface OrdemCompleta extends OrdemDeServico {
  status: string;
  items: ItemDaOS[];
}

/** Oficina nova a cada execução: placa e e-mail nunca colidem entre cenários. */
export async function criarOficina(prefixo: string, placa: string): Promise<Oficina> {
  const marca = `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
  const email = `${prefixo}-${marca}@teste.local`;

  const conta = await api<{ accessToken: string }>('/auth/signup', {
    payload: {
      name: 'Gabriel Teste',
      email,
      password: SENHA,
      organizationName: `Oficina ${prefixo} ${marca}`,
      whatsapp: '(11) 98765-4321',
    },
  });
  const token = conta.accessToken;

  const servico = await api<{ id: string }>('/services', {
    token,
    payload: { name: 'Troca de pastilhas', priceCents: 18000 },
  });
  const peca = await api<{ id: string }>('/parts', {
    token,
    payload: { name: 'Pastilha de freio', salePriceCents: 25000, initialQuantity: 4, initialUnitCostCents: 10000 },
  });
  const cliente = await api<{ id: string }>('/customers', {
    token,
    payload: { name: 'João Pereira', whatsapp: '(11) 91234-5678' },
  });
  const veiculo = await api<{ id: string }>('/vehicles', {
    token,
    payload: { customerId: cliente.id, make: 'Volkswagen', model: 'Gol', plate: placa, yearManufacture: 2012 },
  });

  return { token, email, servicoId: servico.id, pecaId: peca.id, clienteId: cliente.id, veiculoId: veiculo.id };
}

/** OS com um serviço necessário e uma peça recomendada: R$ 180 + 2 × R$ 250. */
export async function abrirOS(oficina: Oficina): Promise<OrdemDeServico> {
  return api<OrdemDeServico>('/work-orders', {
    token: oficina.token,
    payload: {
      customerId: oficina.clienteId,
      vehicleId: oficina.veiculoId,
      complaint: 'Barulho ao frear',
      items: [
        { type: 'SERVICE', serviceId: oficina.servicoId },
        { type: 'PART', partId: oficina.pecaId, quantity: 2, isOptional: true },
      ],
    },
  });
}

export async function enviarOrcamento(oficina: Oficina, ordemId: string): Promise<OrcamentoEnviado> {
  const orcamento = await api<OrcamentoEnviado>(`/work-orders/${ordemId}/quotes`, { token: oficina.token, payload: {} });
  // o link vem com o APP_URL da API; se o e2e roda noutro endereço, reaponta
  return { ...orcamento, publicUrl: orcamento.publicUrl.replace('http://localhost:5173', BASE_URL) };
}

/** Uma OS aprovada, finalizada e paga pela metade, mais um orçamento parado. */
export async function oficinaComMovimento(): Promise<Oficina & { numero: number }> {
  const oficina = await criarOficina('inicio', 'INI1A23');
  const ordem = await abrirOS(oficina);
  const orcamento = await api<{ id: string }>(`/work-orders/${ordem.id}/quotes`, {
    token: oficina.token,
    payload: {},
  });
  await api(`/quotes/${orcamento.id}/manual-decision`, {
    token: oficina.token,
    payload: { decision: 'APPROVED', channel: 'PHONE' },
  });
  await api(`/work-orders/${ordem.id}/start`, { token: oficina.token, payload: {} });
  await api(`/work-orders/${ordem.id}/complete`, { token: oficina.token, payload: {} });
  await api(`/work-orders/${ordem.id}/payments`, {
    token: oficina.token,
    payload: { method: 'PIX', amountCents: 10000 },
  });
  await api(`/work-orders/${ordem.id}/deliver`, { token: oficina.token, payload: {} });

  // um segundo carro, com orçamento esperando resposta
  const segunda = await abrirOS(oficina);
  await api(`/work-orders/${segunda.id}/quotes`, { token: oficina.token, payload: {} });
  return { ...oficina, numero: ordem.number };
}

export async function entrarNoPainel(page: Page, email: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(SENHA);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('heading', { name: /^Olá,/ })).toBeVisible();
}

/**
 * Erro no console reprova o teste. Bug de front costuma aparecer só aqui: a tela
 * continua "passando" enquanto o console grita.
 */
export const test = base.extend<{ semErroDeConsole: void; ignorarErros: RegExp[] }>({
  /**
   * Erros que o cenário PROVOCA de propósito — o 422 do conflito da agenda, por
   * exemplo, que o navegador registra sozinho ao ver a resposta. O teste declara
   * o padrão no começo (`ignorarErros.push(/…/)`); tudo o mais continua reprovando.
   */
  // eslint-disable-next-line no-empty-pattern
  ignorarErros: async ({}, use) => {
    await use([]);
  },
  semErroDeConsole: [
    async ({ page, ignorarErros }, use) => {
      const erros: string[] = [];
      page.on('console', (mensagem) => {
        if (mensagem.type() === 'error') erros.push(`console.error: ${mensagem.text()}`);
      });
      page.on('pageerror', (erro) => erros.push(`pageerror: ${erro.message}`));
      await use();
      const inesperados = erros.filter((erro) => !ignorarErros.some((padrao) => padrao.test(erro)));
      expect(inesperados, 'o navegador registrou erro').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect } from '@playwright/test';

