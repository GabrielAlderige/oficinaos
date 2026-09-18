/**
 * Oficina de demonstração: dados **obviamente fictícios** (DATABASE.md §8) para
 * mostrar o produto funcionando e para o time navegar sem inventar cadastro.
 *
 *   npm run db:seed:demo
 *
 * Tudo é criado pela própria API, com `app.inject`: o seed passa pelas mesmas
 * regras de domínio que a tela usa, então os totais, as reservas, o livro-razão
 * do estoque e as provas de aprovação nascem coerentes. Depois as datas são
 * espalhadas pelos últimos 30 dias, senão o painel mostraria tudo num dia só.
 */
import { sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { formatBRL } from '@oficinaos/shared';
import { buildApp } from '../src/app';
import { readEnv } from '../src/config/env';
import { loadEnv } from '../src/config/load-env';
import { createDatabase } from '../src/db/client';
import { withTenant, withUser } from '../src/db/tenant';
import { createEmailProvider } from '../src/integrations/email/email';
import { createStorageProvider } from '../src/integrations/storage/storage';

loadEnv();

export const DEMO_EMAIL = 'demo@oficinaos.dev';
export const DEMO_PASSWORD = 'demonstracao2026';
const ORG = 'Oficina Demonstração';

/** CPF com dígitos verificadores certos, mas de uma faixa obviamente falsa. */
function cpfFicticio(indice: number): string {
  const base = `9000000${String(indice).padStart(2, '0')}`.slice(0, 9);
  const digito = (parcial: string, peso: number) => {
    const soma = [...parcial].reduce((total, n, i) => total + Number(n) * (peso - i), 0);
    const resto = (soma * 10) % 11;
    return String(resto === 10 ? 0 : resto);
  };
  const d1 = digito(base, 10);
  const d2 = digito(base + d1, 11);
  return base + d1 + d2;
}

/** CNPJ com dígitos verificadores certos, de uma faixa obviamente falsa. */
const CNPJ_FICTICIO = (() => {
  const base = '90000000000';
  const digito = (parcial: string) => {
    const pesos = parcial.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = [...parcial].reduce((total, n, i) => total + Number(n) * pesos[i]!, 0);
    const resto = soma % 11;
    return String(resto < 2 ? 0 : 11 - resto);
  };
  const doze = `${base}1`;
  const d1 = digito(doze);
  return doze + d1 + digito(doze + d1);
})();

/** +55 11 90000-00xx: faixa reservada para exemplo, nunca de gente de verdade. */
const telefoneFicticio = (indice: number) => `(11) 90000-${String(indice).padStart(4, '0')}`;

const CLIENTES = [
  'Ana Paula Ribeiro', 'Bruno Carvalho', 'Camila Nogueira', 'Diego Fontes', 'Eduarda Lima',
  'Fábio Marques', 'Gabriela Prado', 'Henrique Dias', 'Isabela Moraes', 'João Vitor Salles',
];

const VEICULOS = [
  { make: 'Volkswagen', model: 'Gol', plate: 'DEM1A01', yearManufacture: 2014 },
  { make: 'Fiat', model: 'Uno', plate: 'DEM1A02', yearManufacture: 2012 },
  { make: 'Chevrolet', model: 'Onix', plate: 'DEM1A03', yearManufacture: 2019 },
  { make: 'Hyundai', model: 'HB20', plate: 'DEM1A04', yearManufacture: 2018 },
  { make: 'Toyota', model: 'Corolla', plate: 'DEM1A05', yearManufacture: 2020 },
  { make: 'Renault', model: 'Sandero', plate: 'DEM1A06', yearManufacture: 2016 },
  { make: 'Ford', model: 'Ka', plate: 'DEM1A07', yearManufacture: 2015 },
  { make: 'Honda', model: 'Civic', plate: 'DEM1A08', yearManufacture: 2017 },
  { make: 'Jeep', model: 'Renegade', plate: 'DEM1A09', yearManufacture: 2021 },
  { make: 'Nissan', model: 'Kicks', plate: 'DEM1A10', yearManufacture: 2019 },
  { make: 'Volkswagen', model: 'Saveiro', plate: 'DEM1A11', yearManufacture: 2013 },
  { make: 'Fiat', model: 'Strada', plate: 'DEM1A12', yearManufacture: 2022 },
  { make: 'Chevrolet', model: 'S10', plate: 'DEM1A13', yearManufacture: 2018 },
  { make: 'Peugeot', model: '208', plate: 'DEM1A14', yearManufacture: 2016 },
  { make: 'Citroën', model: 'C3', plate: 'DEM1A15', yearManufacture: 2015 },
];

const SERVICOS = [
  { name: 'Troca de óleo e filtro', priceCents: 16000, maintenanceKm: 10000 },
  { name: 'Alinhamento e balanceamento', priceCents: 12000 },
  { name: 'Troca de pastilhas de freio', priceCents: 18000 },
  { name: 'Troca de discos de freio', priceCents: 26000 },
  { name: 'Revisão de suspensão', priceCents: 24000 },
  { name: 'Troca de correia dentada', priceCents: 48000 },
  { name: 'Troca de embreagem', priceCents: 95000 },
  { name: 'Higienização do ar-condicionado', priceCents: 14000 },
  { name: 'Troca de bateria', priceCents: 9000 },
  { name: 'Diagnóstico eletrônico', priceCents: 15000 },
  { name: 'Troca de amortecedores', priceCents: 42000 },
  { name: 'Revisão completa', priceCents: 38000, maintenanceKm: 20000 },
];

const PECAS = [
  { name: 'Óleo 5W30 sintético (1 L)', sku: 'OL-5W30', salePriceCents: 5500, initialQuantity: 40, initialUnitCostCents: 3200, minQuantity: 12 },
  { name: 'Filtro de óleo', sku: 'FL-OLEO', salePriceCents: 4500, initialQuantity: 18, initialUnitCostCents: 2400, minQuantity: 6 },
  { name: 'Filtro de ar', sku: 'FL-AR', salePriceCents: 6500, initialQuantity: 14, initialUnitCostCents: 3600, minQuantity: 5 },
  { name: 'Pastilha de freio dianteira', sku: 'FR-PAST-D', salePriceCents: 22000, initialQuantity: 8, initialUnitCostCents: 12000, minQuantity: 4 },
  { name: 'Disco de freio ventilado', sku: 'FR-DISC', salePriceCents: 31000, initialQuantity: 4, initialUnitCostCents: 18000, minQuantity: 4 },
  { name: 'Correia dentada', sku: 'MT-CORR', salePriceCents: 19000, initialQuantity: 3, initialUnitCostCents: 9800, minQuantity: 2 },
  { name: 'Bateria 60 Ah', sku: 'EL-BAT60', salePriceCents: 42000, initialQuantity: 5, initialUnitCostCents: 27000, minQuantity: 2 },
  { name: 'Amortecedor dianteiro', sku: 'SU-AMOR-D', salePriceCents: 28000, initialQuantity: 2, initialUnitCostCents: 16000, minQuantity: 4 },
  { name: 'Vela de ignição', sku: 'MT-VELA', salePriceCents: 4800, initialQuantity: 24, initialUnitCostCents: 2600, minQuantity: 8 },
  { name: 'Fluido de freio DOT 4', sku: 'FR-FLUI', salePriceCents: 3900, initialQuantity: 10, initialUnitCostCents: 1900, minQuantity: 4 },
];

/** Fornecedores fictícios (DATABASE.md §8): telefone da faixa de exemplo, sem CNPJ de ninguém. */
const FORNECEDORES = [
  { name: 'Central Autopeças Demonstração', contactName: 'Roberto', categories: ['Freios', 'Suspensão'], leadTimeDays: 1, rating: 5 },
  { name: 'Distribuidora de Motores Exemplo', contactName: 'Sandra', categories: ['Motor', 'Filtros', 'Lubrificantes'], leadTimeDays: 2, rating: 4 },
  { name: 'Elétrica Automotiva Fictícia', contactName: 'Paulo', categories: ['Elétrica'], leadTimeDays: 3, rating: 4 },
  { name: 'Peças Rápidas de Teste', contactName: 'Mônica', categories: ['Freios', 'Filtros'], leadTimeDays: 0, rating: 3 },
  { name: 'Atacado de Suspensão Modelo', contactName: 'Jair', categories: ['Suspensão', 'Direção'], leadTimeDays: 5, rating: 3 },
];

/** A peça de índice N compra do fornecedor de índice X (as sem entrada ficam sem preferido). */
const PREFERIDO_POR_PECA: Record<number, number> = { 0: 1, 1: 1, 2: 1, 3: 0, 4: 0, 5: 1, 6: 2, 7: 4, 9: 3 };

const EQUIPE = [
  { name: 'Bruno Tavares', role: 'ADMIN' as const },
  { name: 'Carla Menezes', role: 'MANAGER' as const },
  { name: 'Diego Rocha', role: 'MECHANIC' as const },
  { name: 'Elisa Campos', role: 'ATTENDANT' as const },
  { name: 'Fábio Nunes', role: 'FINANCE' as const },
];

/** O caminho de cada OS: o seed empurra a OS até o status desejado. */
type Roteiro =
  | 'OPEN'
  | 'DIAGNOSING'
  | 'AWAITING_QUOTE'
  | 'AWAITING_APPROVAL'
  | 'QUOTE_REJECTED'
  | 'APPROVED'
  | 'IN_PROGRESS'
  | 'WAITING_PARTS'
  | 'COMPLETED'
  | 'DELIVERED_PAID'
  | 'DELIVERED_PARTIAL'
  | 'CANCELED';

const ROTEIROS: Roteiro[] = [
  'DELIVERED_PAID', 'DELIVERED_PAID', 'DELIVERED_PAID', 'DELIVERED_PARTIAL', 'DELIVERED_PAID',
  'COMPLETED', 'COMPLETED', 'IN_PROGRESS', 'IN_PROGRESS', 'WAITING_PARTS',
  'APPROVED', 'AWAITING_APPROVAL', 'AWAITING_APPROVAL', 'AWAITING_APPROVAL', 'QUOTE_REJECTED',
  'AWAITING_QUOTE', 'DIAGNOSING', 'OPEN', 'OPEN', 'CANCELED',
];

const RECLAMACOES = [
  'Barulho ao frear', 'Revisão dos 20.000 km', 'Puxando para a direita', 'Luz do painel acesa',
  'Ar-condicionado não gela', 'Troca de óleo', 'Vibração acima de 80 km/h', 'Não pega de manhã',
  'Barulho na suspensão', 'Embreagem patinando',
];

/**
 * Ordem de apagamento: filhos antes dos pais. `work_orders` e `appointments` se
 * apontam, então a ligação é desfeita antes de qualquer DELETE.
 */
const NA_ORDEM = [
  'quote_approvals', 'quote_attachments', 'quote_items', 'quotes',
  // financeiro (E13): a baixa aponta para o lançamento, o pagamento também
  'financial_settlements', 'payments', 'financial_entries',
  'work_order_events', 'vehicle_inspections', 'attachments',
  'work_order_items', 'inventory_movements', 'appointments', 'work_orders',
  // a peça aponta para o fornecedor preferido: fornecedor sai depois dela
  'part_applications', 'parts', 'suppliers', 'part_categories', 'services', 'financial_categories',
  'odometer_readings', 'vehicles', 'customers',
  'messages', 'notifications', 'activity_logs',
  'organization_counters', 'usage_counters', 'subscriptions', 'invitations', 'memberships',
];

/**
 * Apaga a oficina de demonstração inteira. Conta demo é feita para mexerem
 * nela, então precisa de um jeito de voltar ao começo. Roda como DONA das
 * tabelas porque a auditoria é append-only para a aplicação — de propósito.
 */
async function reset(): Promise<void> {
  const url = process.env.DATABASE_OWNER_URL;
  if (!url) throw new Error('Falta DATABASE_OWNER_URL no .env');
  const { db, pool } = createDatabase(url, { max: 1 });
  try {
    // `users` é global, sem RLS: é por aqui que se acha a oficina de novo
    const { rows: usuarios } = await db.execute<{ id: string }>(
      sql`select id from users where email like '%@oficinaos.dev'`,
    );
    if (!usuarios.length) {
      console.log('Não havia oficina de demonstração.');
      return;
    }
    // RLS é FORÇADO, então nem a dona das tabelas enxerga linha sem contexto:
    // a oficina sai do vínculo do próprio usuário (policy own_memberships)
    const oficinas = new Set<string>();
    for (const usuario of usuarios) {
      const { rows } = await withUser(db, usuario.id, (tx) =>
        tx.execute<{ organization_id: string }>(sql`select organization_id from memberships`),
      );
      for (const linha of rows) oficinas.add(linha.organization_id);
    }

    // a sessão aponta para a oficina ativa: sai antes dela
    await db.execute(sql`delete from sessions where user_id in (select id from users where email like '%@oficinaos.dev')`);
    await db.execute(
      sql`delete from password_reset_tokens where user_id in (select id from users where email like '%@oficinaos.dev')`,
    );

    for (const organizationId of oficinas) {
      await withTenant(db, { organizationId }, async (tx) => {
        await tx.execute(sql`update work_orders set appointment_id = null`);
        await tx.execute(sql`update appointments set work_order_id = null`);
        for (const tabela of NA_ORDEM) {
          await tx.execute(sql`delete from ${sql.identifier(tabela)}`);
        }
        await tx.execute(sql`delete from organizations where id = ${organizationId}`);
      });
    }
    await db.execute(sql`delete from users where email like '%@oficinaos.dev'`);
    console.log(`Oficina de demonstração apagada (${oficinas.size}).`);
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('O seed de demonstração não roda em produção.');
  }
  if (process.argv.includes('--reset')) {
    await reset();
    if (!process.argv.includes('--seed')) return;
  }
  const env = readEnv(process.env);
  const { db, pool } = createDatabase(env.DATABASE_URL, { max: 4 });
  const app = await buildApp({
    env,
    db,
    email: createEmailProvider(env),
    storage: createStorageProvider(env),
  });
  await app.ready();

  let ip = 0;
  const chamar = async (
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    payload?: unknown,
    token?: string,
  ) => {
    ip += 1;
    const res = await app.inject({
      method,
      url: `/api/v1${url}`,
      payload: payload as never,
      // rotas com cookie de sessão exigem Origin da lista do CORS
      headers: { origin: env.APP_URL, ...(token ? { authorization: `Bearer ${token}` } : {}) },
      // o limite por IP é por endereço: o seed dispara centenas de chamadas
      remoteAddress: `10.90.${Math.floor(ip / 250)}.${ip % 250}`,
    });
    if (res.statusCode >= 400) {
      throw new Error(`${method} ${url} → ${res.statusCode}: ${res.body}`);
    }
    return res.json() as never;
  };

  // 1. a oficina e o dono
  const cadastro = await chamar('POST', '/auth/signup', {
    name: 'Ana Souza',
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    organizationName: ORG,
    whatsapp: telefoneFicticio(1),
  }).catch((erro: Error) => {
    if (erro.message.includes('EMAIL_ALREADY_REGISTERED')) return null;
    throw erro;
  });
  if (!cadastro) {
    console.log(`A oficina de demonstração já existe (${DEMO_EMAIL}). Nada a fazer.`);
    await app.close();
    await pool.end();
    return;
  }
  const { accessToken: dono, me } = cadastro as {
    accessToken: string;
    me: { user: { id: string }; organization: { id: string } };
  };
  const organizationId = me.organization.id;

  await chamar(
    'PATCH',
    '/organization',
    {
      document: CNPJ_FICTICIO,
      phone: telefoneFicticio(1),
      whatsapp: telefoneFicticio(1),
      address: { zip: '01310-100', street: 'Avenida Paulista', number: '1000', district: 'Bela Vista', city: 'São Paulo', state: 'SP', complement: '' },
      businessHours: {
        mon: [['08:00', '12:00'], ['13:00', '18:00']],
        tue: [['08:00', '12:00'], ['13:00', '18:00']],
        wed: [['08:00', '12:00'], ['13:00', '18:00']],
        thu: [['08:00', '12:00'], ['13:00', '18:00']],
        fri: [['08:00', '12:00'], ['13:00', '18:00']],
        sat: [['08:00', '12:00']],
      },
    },
    dono,
  );

  // 2. a equipe: um por papel, todos com a mesma senha da conta demo
  const equipe: { userId: string; role: string; token: string }[] = [];
  for (const [indice, pessoa] of EQUIPE.entries()) {
    const email = `${pessoa.role.toLowerCase()}@oficinaos.dev`;
    const convite = (await chamar('POST', '/members/invitations', { email, role: pessoa.role }, dono)) as {
      inviteUrl: string;
    };
    const token = convite.inviteUrl.slice(convite.inviteUrl.lastIndexOf('/') + 1);
    const aceite = (await chamar('POST', '/auth/accept-invite', {
      token,
      name: pessoa.name,
      password: DEMO_PASSWORD,
    })) as { accessToken: string; me: { user: { id: string } } };
    equipe.push({ userId: aceite.me.user.id, role: pessoa.role, token: aceite.accessToken });
    // cor na agenda, para as colunas não saírem todas cinzas
    const membros = (await chamar('GET', '/members', undefined, dono)) as {
      data: { id: string; userId: string }[];
    };
    const membro = membros.data.find((m) => m.userId === aceite.me.user.id);
    const cores = ['#2563eb', '#16a34a', '#ea580c', '#9333ea', '#0891b2'];
    if (membro) await chamar('PATCH', `/members/${membro.id}`, { calendarColor: cores[indice] }, dono);
  }
  const mecanicos = equipe.filter((p) => p.role === 'MECHANIC' || p.role === 'ADMIN');

  // 3. catálogo
  const servicos: string[] = [];
  for (const servico of SERVICOS) {
    const criado = (await chamar('POST', '/services', servico, dono)) as { id: string };
    servicos.push(criado.id);
  }
  const fornecedores: string[] = [];
  for (const [indice, fornecedor] of FORNECEDORES.entries()) {
    const criado = (await chamar(
      'POST',
      '/suppliers',
      { ...fornecedor, whatsapp: telefoneFicticio(indice + 40) },
      dono,
    )) as { id: string };
    fornecedores.push(criado.id);
  }

  const pecas: string[] = [];
  for (const [indice, peca] of PECAS.entries()) {
    const preferido = PREFERIDO_POR_PECA[indice];
    const criada = (await chamar(
      'POST',
      '/parts',
      { ...peca, preferredSupplierId: preferido === undefined ? null : fornecedores[preferido] },
      dono,
    )) as { id: string };
    pecas.push(criada.id);
  }

  // 4. clientes e veículos
  const clientes: string[] = [];
  for (const [indice, nome] of CLIENTES.entries()) {
    const criado = (await chamar(
      'POST',
      '/customers',
      {
        name: nome,
        document: cpfFicticio(indice + 1),
        whatsapp: telefoneFicticio(indice + 10),
        email: `cliente${indice + 1}@exemplo.invalido`,
      },
      dono,
    )) as { id: string };
    clientes.push(criado.id);
  }

  const veiculos: { id: string; customerId: string }[] = [];
  for (const [indice, veiculo] of VEICULOS.entries()) {
    const customerId = clientes[indice % clientes.length]!;
    const criado = (await chamar(
      'POST',
      '/vehicles',
      { ...veiculo, customerId, odometerKm: 30000 + indice * 7000 },
      dono,
    )) as { id: string };
    veiculos.push({ id: criado.id, customerId });
  }

  // 5. as ordens de serviço, cada uma empurrada até o status do roteiro
  const criadas: { id: string; number: number; roteiro: Roteiro }[] = [];
  for (const [indice, roteiro] of ROTEIROS.entries()) {
    const veiculo = veiculos[indice % veiculos.length]!;
    const mecanico = mecanicos[indice % mecanicos.length]!;
    const ordem = (await chamar(
      'POST',
      '/work-orders',
      {
        customerId: veiculo.customerId,
        vehicleId: veiculo.id,
        complaint: RECLAMACOES[indice % RECLAMACOES.length],
        odometerKm: 31000 + indice * 5000,
        mechanicUserId: mecanico.userId,
        items: [
          { type: 'SERVICE', serviceId: servicos[indice % servicos.length] },
          { type: 'PART', partId: pecas[indice % pecas.length], quantity: indice % 3 === 0 ? 2 : 1 },
          ...(indice % 4 === 0
            ? [{ type: 'SERVICE', serviceId: servicos[(indice + 5) % servicos.length], isOptional: true }]
            : []),
        ],
      },
      dono,
    )) as { id: string; number: number };
    criadas.push({ ...ordem, roteiro });

    const acao = (caminho: string, corpo?: unknown) =>
      chamar('POST', `/work-orders/${ordem.id}/${caminho}`, corpo ?? {}, dono);

    if (roteiro === 'OPEN') continue;
    if (roteiro === 'CANCELED') {
      await acao('cancel', { reason: 'Cliente desistiu do serviço' });
      continue;
    }
    await acao('start-diagnosis');
    if (roteiro === 'DIAGNOSING') continue;
    await acao('finish-diagnosis');
    if (roteiro === 'AWAITING_QUOTE') continue;

    const orcamento = (await chamar('POST', `/work-orders/${ordem.id}/quotes`, {}, dono)) as {
      id: string;
      items: { id: string; isOptional: boolean }[];
    };
    if (roteiro === 'AWAITING_APPROVAL') continue;
    if (roteiro === 'QUOTE_REJECTED') {
      await chamar(
        'POST',
        `/quotes/${orcamento.id}/manual-decision`,
        { decision: 'REJECTED', channel: 'PHONE', rejectionReason: 'Vai fazer em outro lugar' },
        dono,
      );
      continue;
    }
    // quando há item recomendado, o cliente aprova só o necessário: é o caso
    // que faz "taxa em valor" ser diferente de "taxa em quantidade"
    const recomendados = orcamento.items.filter((item) => item.isOptional);
    await chamar(
      'POST',
      `/quotes/${orcamento.id}/manual-decision`,
      recomendados.length
        ? {
            decision: 'PARTIALLY_APPROVED',
            channel: 'WHATSAPP',
            approvedItemIds: orcamento.items.filter((item) => !item.isOptional).map((item) => item.id),
          }
        : { decision: 'APPROVED', channel: indice % 2 ? 'PHONE' : 'IN_PERSON' },
      dono,
    );
    if (roteiro === 'APPROVED') continue;
    await acao('start');
    if (roteiro === 'IN_PROGRESS') continue;
    if (roteiro === 'WAITING_PARTS') {
      await acao('wait-parts');
      continue;
    }
    await acao('complete');
    if (roteiro === 'COMPLETED') continue;

    const ficha = (await chamar('GET', `/work-orders/${ordem.number}`, undefined, dono)) as {
      totals: { approvedTotalCents: number; totalCents: number };
    };
    const devido = ficha.totals.approvedTotalCents || ficha.totals.totalCents;
    const valor = roteiro === 'DELIVERED_PAID' ? devido : Math.round(devido / 2);
    if (valor > 0) {
      await chamar(
        'POST',
        `/work-orders/${ordem.id}/payments`,
        { method: indice % 3 === 0 ? 'PIX' : indice % 3 === 1 ? 'CREDIT_CARD' : 'CASH', amountCents: valor },
        dono,
      );
    }
    await acao('deliver');
  }

  // 6. agenda: alguns compromissos de hoje e dos próximos dias
  const agora = new Date();
  const emDias = (dias: number, hora: number) => {
    const data = new Date(agora);
    data.setDate(data.getDate() + dias);
    data.setHours(hora, 0, 0, 0);
    return data;
  };
  for (let indice = 0; indice < 10; indice += 1) {
    const veiculo = veiculos[(indice + 3) % veiculos.length]!;
    const inicio = emDias(Math.floor(indice / 3), 8 + (indice % 3) * 2);
    const agendamento = (await chamar(
      'POST',
      '/appointments',
      {
        customerId: veiculo.customerId,
        vehicleId: veiculo.id,
        mechanicUserId: mecanicos[indice % mecanicos.length]!.userId,
        title: SERVICOS[indice % SERVICOS.length]!.name,
        startsAt: inicio.toISOString(),
        endsAt: new Date(inicio.getTime() + 90 * 60_000).toISOString(),
        force: true,
      },
      dono,
    )) as { id: string };
    // parte confirmada, parte não: o painel de atenção precisa ter o que mostrar
    if (indice % 3 === 0) await chamar('POST', `/appointments/${agendamento.id}/confirm`, {}, dono);
  }

  /**
   * 6.1 despesas do mês (E13). As contas a RECEBER a própria API criou ao
   * finalizar cada OS; a oficina também paga aluguel, luz e salário, e sem
   * isso o fluxo de caixa teria só uma ponta.
   */
  const categorias = (await chamar('GET', '/finance/categories?direction=PAYABLE', undefined, dono)) as {
    data: { id: string; systemKey: string | null }[];
  };
  const categoriaPor = (chave: string) => categorias.data.find((c) => c.systemKey === chave)!.id;
  const diaDoMes = (dia: number) => {
    const data = new Date();
    data.setDate(Math.min(dia, 28));
    return data.toISOString().slice(0, 10);
  };
  const DESPESAS = [
    // os valores acompanham o tamanho da oficina fictícia (ela fatura ~R$ 4 mil
    // no mês): despesa de oficina grande num movimento pequeno faria a demo
    // abrir com prejuízo de −266% e não ensinaria nada
    { chave: 'RENT', descricao: 'Aluguel do galpão', valor: 120000, dia: 5, paga: true },
    { chave: 'UTILITIES', descricao: 'Energia elétrica', valor: 38400, dia: 10, paga: true },
    { chave: 'UTILITIES', descricao: 'Internet e telefone', valor: 14900, dia: 12, paga: true },
    { chave: 'PAYROLL', descricao: 'Salários da equipe', valor: 120000, dia: 5, paga: true },
    { chave: 'TAXES', descricao: 'Simples Nacional', valor: 32000, dia: 20, paga: false },
    { chave: 'TOOLS', descricao: 'Manutenção do elevador', valor: 28000, dia: 25, paga: false },
    { chave: 'PARTS', descricao: 'Óleo e filtros — Distribuidora Paulista', valor: 84000, dia: 15, paga: false },
  ];
  for (const despesa of DESPESAS) {
    const criada = (await chamar(
      'POST',
      '/finance/entries',
      {
        direction: 'PAYABLE',
        categoryId: categoriaPor(despesa.chave),
        description: despesa.descricao,
        amountCents: despesa.valor,
        dueDate: diaDoMes(despesa.dia),
      },
      dono,
    )) as { data: { id: string }[] };
    if (despesa.paga) {
      await chamar(
        'POST',
        `/finance/entries/${criada.data[0]!.id}/settlements`,
        { clientRequestId: uuidv7(), amountCents: despesa.valor, method: 'BANK_TRANSFER' },
        dono,
      );
    }
  }

  /**
   * 7. espalhar as datas pelos últimos 30 dias. O resto do seed passa pela API,
   * mas "quando aconteceu" a API sempre grava como agora — e um painel com tudo
   * no mesmo dia não mostra nada. O deslocamento é determinístico pelo número da
   * OS, então o histórico fica igual a cada execução.
   */
  // como DONA das tabelas: a prova de aprovação é append-only para a aplicação
  // (E6), e é assim que tem de continuar — o seed é a exceção, não a regra
  const ownerUrl = process.env.DATABASE_OWNER_URL;
  if (!ownerUrl) throw new Error('Falta DATABASE_OWNER_URL no .env');
  const dona = createDatabase(ownerUrl, { max: 1 });
  await withTenant(dona.db, { organizationId, userId: me.user.id }, async (tx) => {
    // o deslocamento cabe no mês corrente: espalhado o bastante para o gráfico
    // ter forma, e sem jogar metade do movimento para o mês passado — foi o que
    // fez a única recusa cair fora da conta e a taxa de aprovação virar 100%
    const DIAS = sql`make_interval(days => (number * 5) % greatest(extract(day from now())::int, 1))`;
    await tx.execute(sql`
      update work_orders set
        opened_at    = opened_at    - ${DIAS} - interval '1 day',
        approved_at  = approved_at  - ${DIAS},
        started_at   = started_at   - ${DIAS},
        completed_at = completed_at - ${DIAS},
        delivered_at = delivered_at - ${DIAS},
        created_at   = created_at   - ${DIAS} - interval '1 day'
      where organization_id = ${organizationId}
    `);
    await tx.execute(sql`
      update quotes set sent_at = sent_at - make_interval(days => (number * 5) % greatest(extract(day from now())::int, 1))
      where organization_id = ${organizationId}
    `);
    await tx.execute(sql`
      update quote_approvals a set created_at = q.sent_at + interval '6 hours'
      from quotes q
      where q.id = a.quote_id and a.organization_id = ${organizationId}
    `);
    await tx.execute(sql`
      update payments p set paid_at = w.delivered_at, created_at = w.delivered_at
      from work_orders w
      where w.id = p.work_order_id and p.organization_id = ${organizationId} and w.delivered_at is not null
    `);
    // a baixa da despesa acontece no dia do vencimento, e não no dia em que o
    // seed rodou: senão o fluxo de caixa mostra tudo numa coluna só
    await tx.execute(sql`
      update financial_settlements s set paid_at = e.due_date::timestamptz + interval '10 hours',
                                         created_at = e.due_date::timestamptz + interval '10 hours'
      from financial_entries e
      where e.id = s.entry_id and s.organization_id = ${organizationId}
    `);
    // e a conta a receber vence no dia em que a OS foi finalizada
    await tx.execute(sql`
      update financial_entries e set due_date = (w.completed_at at time zone 'America/Sao_Paulo')::date,
                                     created_at = w.completed_at
      from work_orders w
      where w.id = e.work_order_id and e.organization_id = ${organizationId} and w.completed_at is not null
    `);
    // clientes novos ao longo do mês, para o gráfico ter o que mostrar
    await tx.execute(sql`
      update customers set created_at = created_at - make_interval(days => (extract(day from created_at)::int % 26) + 1)
      where organization_id = ${organizationId}
    `);
  });

  await dona.pool.end();

  const resumo = (await chamar('GET', '/dashboard/summary?period=month', undefined, dono)) as {
    billedCents: number;
    completedOrders: number;
  };

  console.log('');
  console.log(`Oficina de demonstração criada: ${ORG}`);
  console.log(`  entrar com: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`  a equipe usa a mesma senha: admin@ / manager@ / mechanic@ / attendant@ / finance@oficinaos.dev`);
  console.log(`  ${criadas.length} ordens de serviço, ${clientes.length} clientes, ${veiculos.length} veículos, ${fornecedores.length} fornecedores`);
  console.log(`  faturado no mês: ${formatBRL(resumo.billedCents)} em ${resumo.completedOrders} OS`);
  console.log('');

  await app.close();
  await pool.end();
}

await main();
