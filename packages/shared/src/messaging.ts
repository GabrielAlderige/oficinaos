/**
 * Regras puras do canal de WhatsApp (E22). Mesma razão do resto: a janela de
 * 24 h decide o que a tela oferece (texto livre ou modelo), o que a API
 * aceita, e o que o teste precisa provar — três lugares, uma conta só.
 */

import type { MessageTemplateKey, TemplateCategory } from './enums/messaging';

/**
 * A regra que manda no WhatsApp oficial: passadas **24 horas** da última
 * mensagem que o CLIENTE mandou, a oficina só fala por modelo aprovado. Dentro
 * da janela, conversa normal.
 */
export const JANELA_HORAS = 24;

export function janelaAberta(ultimaEntradaEm: Date | string | null, agora: Date = new Date()): boolean {
  if (!ultimaEntradaEm) return false;
  const quando = ultimaEntradaEm instanceof Date ? ultimaEntradaEm : new Date(ultimaEntradaEm);
  return agora.getTime() - quando.getTime() < JANELA_HORAS * 3_600_000;
}

/** Quanto tempo ainda dá para conversar livremente, em minutos (0 = fechada). */
export function minutosDeJanela(ultimaEntradaEm: Date | string | null, agora: Date = new Date()): number {
  if (!ultimaEntradaEm) return 0;
  const quando = ultimaEntradaEm instanceof Date ? ultimaEntradaEm : new Date(ultimaEntradaEm);
  const fim = quando.getTime() + JANELA_HORAS * 3_600_000;
  return Math.max(0, Math.round((fim - agora.getTime()) / 60_000));
}

export interface ModeloDeMensagem {
  key: MessageTemplateKey;
  label: string;
  /** o que a oficina lê na tela antes de mandar */
  descricao: string;
  categoria: TemplateCategory;
  /**
   * Pode sair sozinha, quando a oficina ligar o envio automático? Só as de
   * UTILIDADE podem — e mesmo assim por escolha explícita dela. Pós-venda e
   * reengajamento **sempre** esperam alguém apertar o botão: mensagem de
   * marketing que sai sozinha é o caminho mais curto para o número ser
   * bloqueado e a oficina perder o WhatsApp que usa para trabalhar.
   */
  podeSerAutomatica: boolean;
  /**
   * O evento que dispara a mensagem sozinha, escrito como a oficina lê ("quando
   * você finaliza a OS"). `null` = ainda **não** há gatilho ligado, e então o
   * automático nem é oferecido: interruptor que não faz nada é pior do que
   * interruptor que não existe.
   */
  gatilho: string | null;
  /** as variáveis do modelo, na ordem em que aparecem no texto */
  variaveis: string[];
}

export const MODELOS_DE_MENSAGEM: ModeloDeMensagem[] = [
  {
    key: 'QUOTE_SENT',
    label: 'Orçamento enviado',
    descricao: 'Manda o link do orçamento para o cliente aprovar pelo celular.',
    categoria: 'UTILITY',
    podeSerAutomatica: true,
    gatilho: null,
    variaveis: ['cliente', 'oficina', 'veiculo', 'valor', 'link'],
  },
  {
    key: 'VEHICLE_READY',
    label: 'Veículo pronto',
    descricao: 'Avisa que o carro está pronto para retirada, com o saldo em aberto se houver.',
    categoria: 'UTILITY',
    podeSerAutomatica: true,
    gatilho: 'quando você finaliza a OS',
    variaveis: ['cliente', 'oficina', 'veiculo', 'saldo'],
  },
  {
    key: 'APPOINTMENT_CONFIRM',
    label: 'Confirmação de agendamento',
    descricao: 'Confirma dia e hora do agendamento, no relógio da oficina.',
    categoria: 'UTILITY',
    podeSerAutomatica: true,
    gatilho: null,
    variaveis: ['cliente', 'oficina', 'quando', 'servico'],
  },
  {
    key: 'CHARGE_LINK',
    label: 'Link de pagamento',
    descricao: 'Manda o Pix, o boleto ou o link da cobrança.',
    categoria: 'UTILITY',
    podeSerAutomatica: false,
    gatilho: null,
    variaveis: ['cliente', 'oficina', 'valor', 'link'],
  },
  {
    key: 'REVIEW_INVITE',
    label: 'Convite para avaliar',
    descricao: 'Pede a avaliação do serviço, com o link de 1 a 5 estrelas.',
    categoria: 'MARKETING',
    podeSerAutomatica: false,
    gatilho: null,
    variaveis: ['cliente', 'oficina', 'link'],
  },
  {
    key: 'POST_SALE',
    label: 'Pós-venda (7 dias)',
    descricao: 'Pergunta como ficou o carro uma semana depois do serviço.',
    categoria: 'MARKETING',
    podeSerAutomatica: false,
    gatilho: null,
    variaveis: ['cliente', 'oficina', 'veiculo'],
  },
  {
    key: 'MAINTENANCE_DUE',
    label: 'Revisão vencendo',
    descricao: 'Lembra que a revisão está perto, por tempo ou por quilometragem.',
    categoria: 'MARKETING',
    podeSerAutomatica: false,
    gatilho: null,
    variaveis: ['cliente', 'oficina', 'veiculo', 'motivo'],
  },
  {
    key: 'NO_RETURN',
    label: 'Cliente sem voltar',
    descricao: 'Chama de volta quem não aparece há seis meses.',
    categoria: 'MARKETING',
    podeSerAutomatica: false,
    gatilho: null,
    variaveis: ['cliente', 'oficina', 'veiculo'],
  },
];

export const modeloPorChave = (key: MessageTemplateKey): ModeloDeMensagem | undefined =>
  MODELOS_DE_MENSAGEM.find((modelo) => modelo.key === key);

/** O que a tela de conversa pode oferecer agora. */
export interface OQuePodeEnviar {
  textoLivre: boolean;
  /** só modelo aprovado sai com a janela fechada */
  somenteModelo: boolean;
  motivo: string;
}

export function oQuePodeEnviar(input: {
  canalConectado: boolean;
  ultimaEntradaEm: Date | string | null;
  agora?: Date;
}): OQuePodeEnviar {
  if (!input.canalConectado) {
    return {
      textoLivre: false,
      somenteModelo: false,
      motivo: 'O WhatsApp da oficina ainda não está conectado: as mensagens saem pelo link, como antes.',
    };
  }
  if (janelaAberta(input.ultimaEntradaEm, input.agora)) {
    const minutos = minutosDeJanela(input.ultimaEntradaEm, input.agora);
    const horas = Math.floor(minutos / 60);
    return {
      textoLivre: true,
      somenteModelo: false,
      motivo:
        horas >= 1
          ? `O cliente respondeu há pouco: dá para conversar livremente por mais ${horas} h.`
          : `A janela de conversa fecha em ${minutos} min. Depois disso, só modelo aprovado.`,
    };
  }
  return {
    textoLivre: false,
    somenteModelo: true,
    motivo: 'Faz mais de 24 h que o cliente não escreve: a Meta só aceita modelo aprovado agora.',
  };
}

/**
 * O telefone no formato que a API da Meta espera: só dígitos, com o código do
 * país. Número brasileiro sem o 55 na frente é o erro mais comum aqui.
 */
export function telefoneParaApi(telefone: string): string {
  const digitos = telefone.replace(/\D/g, '');
  if (digitos.startsWith('55')) return digitos;
  return `55${digitos}`;
}

/**
 * O corpo do modelo **como a Meta precisa receber**: o texto com `{{1}}`,
 * `{{2}}`… no lugar dos dados. É isto que a oficina cola no painel dela ao
 * submeter o modelo, e é isto que o cliente vê quando a mensagem sai por
 * modelo (janela fechada) — a Meta usa o texto aprovado lá, não o nosso.
 *
 * Dentro da janela de 24 h o texto é escrito pelos construtores de sempre
 * (`whatsappPostSaleMessage` e companhia), com os mesmos dizeres. As duas
 * formas têm de combinar, e é por isso que a ordem das variáveis aqui é a
 * mesma de `variaveis` no catálogo: o teste confere as duas.
 */
export function corpoDoModelo(key: MessageTemplateKey): string {
  switch (key) {
    case 'QUOTE_SENT':
      return [
        'Olá, {{1}}! Aqui é da {{2}}.',
        'Preparamos o orçamento do seu {{3}}: {{4}}.',
        'Você pode ver os itens e aprovar por aqui:',
        '{{5}}',
      ].join('\n\n');
    case 'VEHICLE_READY':
      return [
        'Olá, {{1}}! Aqui é da {{2}}.',
        'Seu {{3}} está pronto para retirada.',
        'Ficou {{4}} em aberto, que pode ser acertado na retirada.',
        'Qualquer dúvida, é só responder por aqui.',
      ].join('\n\n');
    case 'APPOINTMENT_CONFIRM':
      return [
        'Olá, {{1}}! Aqui é da {{2}}.',
        'Confirmando o agendamento de {{4}}, {{3}}.',
        'Consegue vir nesse horário? Se precisar remarcar, é só responder por aqui.',
      ].join('\n\n');
    case 'CHARGE_LINK':
      return [
        'Oi, {{1}}! Aqui é da {{2}}.',
        'Este é o link para pagar {{3}}:',
        '{{4}}',
        'Qualquer dúvida, é só responder por aqui.',
      ].join('\n\n');
    case 'REVIEW_INVITE':
      return [
        'Olá, {{1}}! Aqui é da {{2}}.',
        'Você consegue avaliar o atendimento? São 30 segundos e ajuda muito a gente a melhorar:',
        '{{3}}',
      ].join('\n\n');
    case 'POST_SALE':
      return [
        'Olá, {{1}}! Aqui é da {{2}}.',
        'Passando para saber como ficou o serviço do seu {{3}}. Está tudo certo com o carro?',
        'Se aparecer qualquer coisa, me chama por aqui que a gente resolve.',
      ].join('\n\n');
    case 'MAINTENANCE_DUE':
      return [
        'Olá, {{1}}! Aqui é da {{2}}.',
        'A revisão do {{3}} está chegando: {{4}}.',
        'Quer que eu já separe um horário? Me diga o melhor dia que eu reservo.',
      ].join('\n\n');
    case 'NO_RETURN':
      return [
        'Olá, {{1}}! Aqui é da {{2}}.',
        'Faz um tempo que não vemos o {{3}} por aqui. Está tudo bem com ele?',
        'Se quiser uma revisão ou só tirar uma dúvida, é só responder por aqui.',
      ].join('\n\n');
  }
}

/** O nome do modelo na Meta quando a oficina não informa outro. */
export const nomePadraoDoModelo = (key: MessageTemplateKey): string => key.toLowerCase();

// ============================ respostas rápidas ============================

/**
 * O que a oficina digita o dia inteiro, pronto para um toque.
 *
 * Isto **não** é modelo da Meta: é rascunho. A resposta rápida preenche o
 * campo de texto, a pessoa lê, ajusta se quiser e manda. Por isso elas são
 * perguntas e avisos curtos, e não promessas com data e hora que ninguém
 * conferiu — quem promete é a pessoa, não o sistema.
 *
 * Dentro da janela de 24 h elas saem como texto livre; fora dela, a Meta só
 * aceita modelo aprovado, e a tela diz isso.
 */
export interface ContextoDaResposta {
  /** primeiro nome do cliente */
  cliente: string;
  oficina: string;
  /** "VW Gol" ou "carro", quando não há veículo no cadastro */
  veiculo: string;
}

export interface RespostaRapida {
  key: string;
  /** a etapa do atendimento em que ela é usada */
  grupo: string;
  /** o rótulo do botão: curto, para caber numa linha */
  titulo: string;
  texto: (ctx: ContextoDaResposta) => string;
}

export const RESPOSTAS_RAPIDAS: RespostaRapida[] = [
  // ------------------------------- abertura -------------------------------
  {
    key: 'SAUDACAO',
    grupo: 'Abertura',
    titulo: 'Saudação',
    texto: (c) => `Olá, ${c.cliente}! Aqui é da ${c.oficina}. Em que posso ajudar?`,
  },
  {
    key: 'RETORNO',
    grupo: 'Abertura',
    titulo: 'Retornando contato',
    texto: (c) => `Oi, ${c.cliente}! Aqui é da ${c.oficina}, retornando o seu contato.`,
  },
  // ------------------------------ agendamento -----------------------------
  {
    key: 'QUANDO_TRAZER',
    grupo: 'Agendamento',
    titulo: 'Quando trazer',
    texto: (c) => `Qual o melhor dia e horário para você trazer o ${c.veiculo}?`,
  },
  {
    key: 'ENCAIXE',
    grupo: 'Agendamento',
    titulo: 'Tenho encaixe',
    texto: (c) => `Consigo encaixar o ${c.veiculo} nos próximos dias. Qual dia fica melhor para você?`,
  },
  {
    key: 'CONFIRMA_HORARIO',
    grupo: 'Agendamento',
    titulo: 'Confirmar horário',
    texto: () => 'Consegue confirmar o horário para mim? Assim eu já reservo a rampa.',
  },
  // -------------------------- carro na oficina ----------------------------
  {
    key: 'RECEBEMOS',
    grupo: 'Na oficina',
    titulo: 'Recebemos o carro',
    texto: (c) => `Recebemos o seu ${c.veiculo}. Assim que o mecânico avaliar, te passo o diagnóstico.`,
  },
  {
    key: 'NA_RAMPA',
    grupo: 'Na oficina',
    titulo: 'Já está na rampa',
    texto: (c) => `Estamos com o ${c.veiculo} na rampa agora. Te aviso assim que terminar.`,
  },
  {
    key: 'VAI_DEMORAR',
    grupo: 'Na oficina',
    titulo: 'Vai demorar mais',
    texto: (c) => `O serviço no ${c.veiculo} vai levar um pouco mais de tempo do que a gente previu. Te aviso assim que tiver novidade.`,
  },
  // ------------------------------- orçamento ------------------------------
  {
    key: 'ORCAMENTO_PRONTO',
    grupo: 'Orçamento',
    titulo: 'Orçamento pronto',
    texto: (c) => `Preparei o orçamento do seu ${c.veiculo}. Posso te mandar por aqui?`,
  },
  {
    key: 'LEMBRAR_ORCAMENTO',
    grupo: 'Orçamento',
    titulo: 'Lembrar do orçamento',
    texto: () => 'Conseguiu dar uma olhada no orçamento? Qualquer dúvida, é só me chamar por aqui.',
  },
  {
    key: 'ACHAMOS_MAIS',
    grupo: 'Orçamento',
    titulo: 'Achamos mais coisa',
    texto: (c) => `Encontramos mais um ponto para resolver no ${c.veiculo}. Posso te explicar por aqui ou prefere que eu ligue?`,
  },
  // --------------------------------- peça ---------------------------------
  {
    key: 'PECA_PEDIDA',
    grupo: 'Peça',
    titulo: 'Peça pedida',
    texto: (c) => `A peça do seu ${c.veiculo} já foi pedida. Assim que ela chegar, eu te aviso.`,
  },
  {
    key: 'PECA_CHEGOU',
    grupo: 'Peça',
    titulo: 'Peça chegou',
    texto: (c) => `A peça chegou! Pode trazer o ${c.veiculo} quando for melhor para você.`,
  },
  {
    key: 'PECA_EM_FALTA',
    grupo: 'Peça',
    titulo: 'Peça em falta',
    texto: () => 'A peça está em falta nos fornecedores. Estou procurando outra opção e te dou notícia hoje mesmo.',
  },
  // -------------------------------- retirada ------------------------------
  {
    key: 'PRONTO',
    grupo: 'Retirada',
    titulo: 'Carro pronto',
    texto: (c) => `Seu ${c.veiculo} está pronto para retirada.`,
  },
  {
    key: 'QUE_HORAS_BUSCA',
    grupo: 'Retirada',
    titulo: 'Que horas busca',
    texto: (c) => `Que horas você consegue buscar o ${c.veiculo}?`,
  },
  {
    key: 'AINDA_AQUI',
    grupo: 'Retirada',
    titulo: 'Carro ainda aqui',
    texto: (c) => `O ${c.veiculo} está pronto e ainda está aqui com a gente. Consegue passar hoje?`,
  },
  // ------------------------------- pagamento ------------------------------
  {
    key: 'FORMAS_PAGAMENTO',
    grupo: 'Pagamento',
    titulo: 'Formas de pagamento',
    texto: () => 'Aceitamos Pix, cartão e dinheiro. Como prefere pagar?',
  },
  {
    key: 'SALDO_NA_RETIRADA',
    grupo: 'Pagamento',
    titulo: 'Acertar na retirada',
    texto: () => 'Consegue acertar o restante na hora da retirada?',
  },
  // ------------------------------- pós-venda ------------------------------
  {
    key: 'TUDO_CERTO',
    grupo: 'Pós-venda',
    titulo: 'Ficou tudo certo?',
    texto: (c) => `Tudo certo com o ${c.veiculo} depois do serviço?`,
  },
  {
    key: 'QUALQUER_COISA',
    grupo: 'Pós-venda',
    titulo: 'Estou à disposição',
    texto: () => 'Qualquer barulho ou dúvida, me chama por aqui que a gente resolve.',
  },
];

/** Os grupos na ordem em que o atendimento acontece. */
export const GRUPOS_DE_RESPOSTA = [...new Set(RESPOSTAS_RAPIDAS.map((resposta) => resposta.grupo))];

/** As respostas já escritas com os dados do cliente. */
export function respostasRapidas(ctx: ContextoDaResposta): { key: string; grupo: string; titulo: string; body: string }[] {
  return RESPOSTAS_RAPIDAS.map((resposta) => ({
    key: resposta.key,
    grupo: resposta.grupo,
    titulo: resposta.titulo,
    body: resposta.texto(ctx),
  }));
}
