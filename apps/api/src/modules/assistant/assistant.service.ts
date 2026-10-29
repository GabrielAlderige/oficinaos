import Anthropic from '@anthropic-ai/sdk';
import type {
  BetaMessage,
  BetaMessageParam,
  BetaTool,
  BetaToolResultBlockParam,
  BetaToolUseBlock,
  MessageCreateParamsNonStreaming,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import {
  can,
  dayKey,
  ErrorCode,
  formatBRL,
  periodRange,
  WORK_ORDER_STATUS_LABELS,
  type AssistantChatInput,
  type AssistantProposal,
  type AssistantReply,
  type AssistantStatus,
  type Permission,
} from '@oficinaos/shared';
import type { Env } from '../../config/env';
import type { AuthContext, ServiceDeps } from '../../core/auth-context';
import { AppError } from '../../core/errors';
import { readTimezone } from '../../core/org-settings';
import { withTenant } from '../../db/tenant';
import type { AppointmentsService } from '../appointments/appointments.service';
import type { CustomersService } from '../customers/customers.service';
import * as orgRepo from '../organizations/organizations.repository';
import type { PartsService } from '../parts/parts.service';
import type { WorkOrdersService } from '../work-orders/work-orders.service';

/** Uma chamada ao modelo. Os testes trocam por um modelo falso, sem rede. */
export type AssistantModel = (params: MessageCreateParamsNonStreaming) => Promise<BetaMessage>;

/**
 * O modelo de verdade, ou `null` sem a chave (o assistente fica desligado).
 * A recusa por segurança cai no fallback padrão do servidor da Anthropic,
 * que refaz a mesma pergunta num modelo que aceite, dentro da mesma chamada.
 */
export function createAssistantModel(env: Env): AssistantModel | null {
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;
  const client = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 2 });
  return (params) => client.beta.messages.create(params);
}

/** Voltas de ferramenta por pergunta: o bastante para "busca, depois detalha". */
const MAX_VOLTAS = 6;

const texto = (descricao: string) => ({ type: 'string' as const, description: descricao });

/**
 * As ferramentas. As de BUSCA rodam aqui, com as permissões de quem
 * perguntou; as de CADASTRO (`propor_*`) não gravam nada: viram um botão de
 * confirmar na tela, que chama a rota de sempre.
 */
const FERRAMENTAS: (BetaTool & { permission: Permission | null })[] = [
  {
    name: 'buscar_ordens_de_servico',
    description:
      'Busca ordens de serviço (OS) pelo número, pela placa ou pelo nome do cliente. Use "na_oficina" para os carros que ainda estão na oficina e "todas" para incluir as entregues e canceladas.',
    input_schema: {
      type: 'object',
      properties: {
        busca: texto('Número da OS, placa ou nome do cliente. Vazio lista as mais recentes.'),
        situacao: { type: 'string', enum: ['na_oficina', 'todas'] },
      },
      required: ['busca', 'situacao'],
      additionalProperties: false,
    },
    strict: true,
    permission: 'work_orders:read',
  },
  {
    name: 'buscar_pecas',
    description: 'Busca peças do estoque pelo nome ou pelo código. Devolve preço de venda e quantidade disponível.',
    input_schema: {
      type: 'object',
      properties: { busca: texto('Nome da peça, código interno ou código do fabricante.') },
      required: ['busca'],
      additionalProperties: false,
    },
    strict: true,
    permission: 'catalog:read',
  },
  {
    name: 'buscar_clientes',
    description: 'Busca clientes pelo nome, telefone, documento ou placa de um carro dele.',
    input_schema: {
      type: 'object',
      properties: { busca: texto('Nome, telefone, CPF/CNPJ ou placa.') },
      required: ['busca'],
      additionalProperties: false,
    },
    strict: true,
    permission: 'customers:read',
  },
  {
    name: 'ver_agenda',
    description: 'Lista os agendamentos de um dia.',
    input_schema: {
      type: 'object',
      properties: { data: texto('O dia, no formato AAAA-MM-DD.') },
      required: ['data'],
      additionalProperties: false,
    },
    strict: true,
    permission: 'appointments:read',
  },
  {
    name: 'propor_cadastro_de_cliente',
    description:
      'Prepara o cadastro de um cliente novo. NÃO grava: mostra um botão para a pessoa confirmar. Busque antes com buscar_clientes para não duplicar.',
    input_schema: {
      type: 'object',
      properties: {
        nome: texto('Nome completo do cliente.'),
        whatsapp: texto('Celular com DDD, ou vazio.'),
        email: texto('E-mail, ou vazio.'),
      },
      required: ['nome', 'whatsapp', 'email'],
      additionalProperties: false,
    },
    strict: true,
    permission: 'customers:write',
  },
  {
    name: 'propor_cadastro_de_servico',
    description:
      'Prepara o cadastro de um serviço de mão de obra no catálogo. NÃO grava: mostra um botão para a pessoa confirmar.',
    input_schema: {
      type: 'object',
      properties: {
        nome: texto('Nome do serviço, como o cliente entende (ex.: "Troca de óleo").'),
        preco_em_reais: { type: ['number', 'null'], description: 'Preço em reais, ou null se não foi dito.' },
        minutos: { type: ['integer', 'null'], description: 'Tempo estimado em minutos, ou null.' },
      },
      required: ['nome', 'preco_em_reais', 'minutos'],
      additionalProperties: false,
    },
    strict: true,
    permission: 'catalog:write',
  },
];

interface Servicos {
  workOrders: WorkOrdersService;
  customers: CustomersService;
  parts: PartsService;
  appointments: AppointmentsService;
}

/**
 * Assistente com IA (E49). Ver `packages/shared/src/assistant.ts`.
 *
 * A conversa chega inteira (só texto) a cada pergunta: o servidor não guarda
 * histórico. Dentro de UMA pergunta, o laço chama o modelo, roda as buscas e
 * devolve os resultados até ele responder — anexando a resposta do modelo
 * inteira a cada volta, sem editar nada do que veio antes.
 */
export class AssistantService {
  /** perguntas de hoje por oficina; zera na virada do dia e quando a API reinicia */
  private readonly usoDoDia = new Map<string, { dia: string; usadas: number }>();

  constructor(
    private readonly deps: ServiceDeps,
    private readonly model: AssistantModel | null,
    private readonly servicos: Servicos,
  ) {}

  status(auth: AuthContext): AssistantStatus {
    return { enabled: this.model !== null, remainingToday: Math.max(0, this.deps.env.ASSISTANT_DAILY_LIMIT - this.usadasHoje(auth)) };
  }

  async chat(auth: AuthContext, input: AssistantChatInput): Promise<AssistantReply> {
    if (!this.model) {
      throw new AppError(503, ErrorCode.ASSISTANT_DISABLED, 'Assistente desligado', 'O assistente com IA não está configurado neste servidor.');
    }
    if (input.messages[0]?.role !== 'user' || input.messages.at(-1)?.role !== 'user') {
      throw new AppError(422, ErrorCode.VALIDATION_FAILED, 'Conversa inválida', 'A conversa começa e termina com a pergunta da pessoa.');
    }
    if (this.usadasHoje(auth) >= this.deps.env.ASSISTANT_DAILY_LIMIT) {
      throw new AppError(
        429,
        ErrorCode.RATE_LIMITED,
        'Limite do dia',
        `A oficina já fez ${this.deps.env.ASSISTANT_DAILY_LIMIT} perguntas hoje. O assistente volta amanhã.`,
      );
    }
    this.contar(auth);

    const contexto = await withTenant(this.deps.db, auth, async (tx) => {
      const oficina = await orgRepo.findOrganization(tx, auth.organizationId);
      const tz = await readTimezone(tx, auth.organizationId);
      return { nome: oficina?.name ?? 'Oficina', hoje: dayKey(new Date(), tz), tz };
    });

    const ferramentas = FERRAMENTAS.filter((f) => f.permission === null || can(auth.role, f.permission)).map(
      ({ permission: _permission, ...tool }) => tool,
    );
    const messages: BetaMessageParam[] = input.messages.map((m) => ({ role: m.role, content: m.content }));
    const links: AssistantReply['links'] = [];
    const proposals: AssistantProposal[] = [];

    for (let volta = 0; volta < MAX_VOLTAS; volta += 1) {
      const resposta = await this.model({
        model: this.deps.env.ASSISTANT_MODEL,
        max_tokens: 16_000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'low' },
        system: sistema(contexto.nome, contexto.hoje),
        tools: ferramentas,
        messages,
      });

      if (resposta.stop_reason === 'refusal') {
        return { reply: 'Não posso ajudar com isso por aqui.', links, proposals };
      }
      const usos = resposta.content.filter((bloco): bloco is BetaToolUseBlock => bloco.type === 'tool_use');
      if (resposta.stop_reason !== 'tool_use' || !usos.length) {
        const fala = resposta.content
          .flatMap((bloco) => (bloco.type === 'text' ? [bloco.text] : []))
          .join('\n')
          .trim();
        return { reply: fala || 'Não encontrei uma resposta. Tente perguntar de outro jeito.', links, proposals };
      }

      // a resposta inteira volta para a conversa, sem cortar nada (thinking incluído)
      messages.push({ role: 'assistant', content: resposta.content });
      const resultados: BetaToolResultBlockParam[] = [];
      for (const uso of usos) {
        try {
          const saida = await this.executar(auth, contexto.tz, uso, links, proposals);
          resultados.push({ type: 'tool_result', tool_use_id: uso.id, content: JSON.stringify(saida) });
        } catch (erro) {
          resultados.push({
            type: 'tool_result',
            tool_use_id: uso.id,
            is_error: true,
            content: erro instanceof AppError ? (erro.detail ?? erro.title) : 'A busca falhou.',
          });
        }
      }
      messages.push({ role: 'user', content: resultados });
    }
    return { reply: 'A pergunta precisou de buscas demais. Tente algo mais específico.', links, proposals };
  }

  private async executar(
    auth: AuthContext,
    tz: string,
    uso: BetaToolUseBlock,
    links: AssistantReply['links'],
    proposals: AssistantProposal[],
  ): Promise<unknown> {
    const ferramenta = FERRAMENTAS.find((f) => f.name === uso.name);
    // a lista enviada ao modelo já é filtrada; esta checagem é a que vale
    if (!ferramenta || (ferramenta.permission && !can(auth.role, ferramenta.permission))) {
      throw new AppError(403, ErrorCode.FORBIDDEN, 'Sem permissão', 'O papel desta pessoa não permite essa consulta.');
    }
    const entrada = uso.input as Record<string, unknown>;
    const busca = typeof entrada.busca === 'string' ? entrada.busca.trim().slice(0, 100) : '';

    switch (uso.name) {
      case 'buscar_ordens_de_servico': {
        const pagina = await this.servicos.workOrders.list(auth, {
          q: busca || undefined,
          status: entrada.situacao === 'todas' ? 'all' : 'active',
          page: 1,
          pageSize: 8,
        });
        for (const os of pagina.data.slice(0, 4)) links.push({ label: `OS ${os.number}`, href: `/ordens/${os.number}` });
        return pagina.data.map((os) => ({
          numero: os.number,
          situacao: WORK_ORDER_STATUS_LABELS[os.status],
          cliente: os.customerName,
          placa: os.vehiclePlate,
          carro: os.vehicleName,
          mecanico: os.mechanicName,
          total: formatBRL(os.totalCents),
          aberta_em: os.openedAt.slice(0, 10),
        }));
      }
      case 'buscar_pecas': {
        const pagina = await this.servicos.parts.list(auth, {
          q: busca || undefined,
          page: 1,
          pageSize: 8,
          stock: 'all',
        });
        for (const peca of pagina.data.slice(0, 4)) links.push({ label: peca.name, href: `/pecas/${peca.id}` });
        return pagina.data.map((peca) => ({
          nome: peca.name,
          codigo: peca.sku ?? peca.manufacturerCode,
          marca: peca.manufacturer,
          preco_de_venda: peca.salePriceCents === null ? 'sem preço' : formatBRL(peca.salePriceCents),
          disponivel: peca.quantityAvailable,
          unidade: peca.unit,
          local: peca.location,
        }));
      }
      case 'buscar_clientes': {
        const pagina = await this.servicos.customers.list(auth, { q: busca || undefined, page: 1, pageSize: 8 });
        for (const cliente of pagina.data.slice(0, 4)) links.push({ label: cliente.name, href: `/clientes/${cliente.id}` });
        // telefone e documento vêm mascarados para quem não pode ver contato
        return pagina.data.map((cliente) => ({
          nome: cliente.name,
          whatsapp: cliente.whatsapp,
          telefone: cliente.phone,
          placas: cliente.plates,
        }));
      }
      case 'ver_agenda': {
        const dia = typeof entrada.data === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entrada.data) ? entrada.data : dayKey(new Date(), tz);
        const faixa = periodRange('custom', tz, { from: dia, to: dia });
        const agenda = await this.servicos.appointments.list(auth, {
          from: faixa.from.toISOString(),
          to: faixa.to.toISOString(),
        });
        links.push({ label: 'Abrir a agenda', href: '/agenda' });
        return agenda.data.map((ag) => ({
          inicio: ag.startsAt,
          fim: ag.endsAt,
          cliente: ag.customerName,
          carro: ag.vehicleLabel,
          servico: ag.title,
          mecanico: ag.mechanicName,
          situacao: ag.status,
        }));
      }
      case 'propor_cadastro_de_cliente': {
        const nome = String(entrada.nome ?? '').trim();
        if (nome.length < 2) throw new AppError(422, ErrorCode.VALIDATION_FAILED, 'Sem nome', 'Falta o nome do cliente.');
        proposals.push({
          kind: 'customer',
          name: nome.slice(0, 120),
          whatsapp: String(entrada.whatsapp ?? '').trim().slice(0, 30),
          email: String(entrada.email ?? '').trim().slice(0, 120),
        });
        return { ok: 'O cadastro apareceu para a pessoa confirmar no botão. Ainda não foi gravado.' };
      }
      case 'propor_cadastro_de_servico': {
        const nome = String(entrada.nome ?? '').trim();
        if (nome.length < 2) throw new AppError(422, ErrorCode.VALIDATION_FAILED, 'Sem nome', 'Falta o nome do serviço.');
        const reais = typeof entrada.preco_em_reais === 'number' && entrada.preco_em_reais >= 0 ? entrada.preco_em_reais : null;
        const minutos = typeof entrada.minutos === 'number' && entrada.minutos > 0 ? Math.round(entrada.minutos) : null;
        proposals.push({
          kind: 'service',
          name: nome.slice(0, 120),
          priceCents: reais === null ? null : Math.round(reais * 100),
          estimatedMinutes: minutos,
        });
        return { ok: 'O cadastro apareceu para a pessoa confirmar no botão. Ainda não foi gravado.' };
      }
      default:
        throw new AppError(422, ErrorCode.VALIDATION_FAILED, 'Ferramenta desconhecida', `Não existe a ferramenta ${uso.name}.`);
    }
  }

  private usadasHoje(auth: AuthContext): number {
    const uso = this.usoDoDia.get(auth.organizationId);
    return uso && uso.dia === new Date().toISOString().slice(0, 10) ? uso.usadas : 0;
  }

  private contar(auth: AuthContext) {
    const dia = new Date().toISOString().slice(0, 10);
    const uso = this.usoDoDia.get(auth.organizationId);
    this.usoDoDia.set(auth.organizationId, { dia, usadas: uso && uso.dia === dia ? uso.usadas + 1 : 1 });
  }
}

/**
 * O que o modelo precisa saber. A data vai no fim: o resto do texto é igual
 * para toda pergunta da oficina.
 */
function sistema(oficina: string, hoje: string): string {
  return [
    `Você é o assistente do OficinaOS, o sistema de gestão da oficina mecânica "${oficina}".`,
    'Quem conversa com você é alguém da equipe da oficina (dono, atendente, mecânico). Responda em português do Brasil, curto e direto, como um colega de balcão.',
    'Para qualquer dado da oficina (OS, peças, estoque, preços, clientes, agenda), use as ferramentas. Nunca invente número de OS, placa, preço, quantidade ou nome: se a busca não achou, diga que não achou.',
    'Para cadastrar cliente ou serviço, use as ferramentas propor_cadastro_*. Elas não gravam nada: aparece um botão para a pessoa confirmar. Diga isso na resposta.',
    'Você não altera OS, não dá baixa, não muda preço nem apaga nada. Se pedirem, explique onde fazer isso no sistema.',
    'Se uma ferramenta disser que o papel da pessoa não permite, diga isso com educação.',
    `Hoje é ${hoje}.`,
  ].join('\n');
}
