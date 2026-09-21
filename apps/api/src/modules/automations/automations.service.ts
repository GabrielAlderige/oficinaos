import {
  assuntoDoResumoDiario,
  AUTOMATION_DEFAULTS,
  dayKey,
  deveRodarAgora,
  ORDEM_DAS_AUTOMACOES,
  temAlgoARelatar,
  textoDoResumoDiario,
  type AutomationKey,
  type AutomationsOverview,
  type AutomationSettings,
  type UpdateAutomationSettingsInput,
} from '@oficinaos/shared';
import { recordActivity } from '../../core/audit';
import type { AuthContext, ClientInfo, ServiceDeps } from '../../core/auth-context';
import { withJobRunner, withTenant } from '../../db/tenant';
import type { Tx } from '../../db/tenant';
import { sincronizarFilaDePosVenda } from '../aftersales/follow-ups.sync';
import * as orgRepo from '../organizations/organizations.repository';
import * as repo from './automations.repository';

/** Hora local (0..23) da oficina. */
const horaNaOficina = (timezone: string): number =>
  Number(new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', hour12: false }).format(new Date()));

/** O fim do dia de amanhã, no relógio da oficina, como instante. */
function janelaDeAmanha(timezone: string): { de: Date; ate: Date } {
  const agora = new Date();
  const amanha = new Date(agora.getTime() + 86_400_000);
  const dia = dayKey(amanha, timezone);
  // o dia da oficina começa 00:00 local; o offset sai do próprio Intl
  const de = new Date(`${dia}T00:00:00${offsetDe(timezone, amanha)}`);
  return { de, ate: new Date(de.getTime() + 86_400_000) };
}

/** '-03:00' do fuso da oficina naquele instante. */
function offsetDe(timeZone: string, quando: Date): string {
  const partes = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' }).formatToParts(quando);
  const nome = partes.find((parte) => parte.type === 'timeZoneName')?.value ?? 'GMT-03:00';
  return nome.replace('GMT', '') || '+00:00';
}

/**
 * Automações (V3, E21): o que o sistema faz sozinho todo dia.
 *
 * Três regras que explicam o resto:
 *
 * 1. **Nenhuma automação manda mensagem para o cliente.** Ela deixa PRONTO —
 *    a fila do dia, o aviso no sino, o resumo por e-mail para a oficina — e
 *    quem aperta enviar continua sendo uma pessoa (o WhatsApp oficial é E22).
 * 2. **Uma vez por dia, no relógio da oficina**: quem decide é
 *    `deveRodarAgora` com a hora local e a última execução gravada. O
 *    trabalhador acorda de hora em hora justamente para caber todo fuso.
 * 3. **Toda execução vira registro** (`automation_runs`), com o que foi criado
 *    e o erro, se houve. Automação sem registro é promessa, e promessa não se
 *    audita.
 */
export class AutomationsService {
  constructor(private readonly deps: ServiceDeps) {}

  // ---------------------------- configuração -----------------------------

  async overview(auth: AuthContext): Promise<AutomationsOverview> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const settings = await this.readSettings(tx, auth.organizationId);
      // uma linha por automação: a mais recente de cada uma
      const vistas = new Set<AutomationKey>();
      const runs = (await repo.recentRuns(tx, auth.organizationId))
        .filter((run) => !vistas.has(run.key) && vistas.add(run.key))
        .map((run) => ({
          key: run.key,
          ranAt: run.ranAt.toISOString(),
          created: run.created,
          durationMs: run.durationMs,
          error: run.error,
        }));
      return { settings, runs };
    });
  }

  private async readSettings(tx: Tx, organizationId: string): Promise<AutomationSettings> {
    const row = await repo.findSettings(tx, organizationId);
    return {
      followUpQueue: row?.followUpQueue ?? AUTOMATION_DEFAULTS.followUpQueue,
      appointmentReminder: row?.appointmentReminder ?? AUTOMATION_DEFAULTS.appointmentReminder,
      quoteNoAnswer: row?.quoteNoAnswer ?? AUTOMATION_DEFAULTS.quoteNoAnswer,
      dailyDigest: row?.dailyDigest ?? AUTOMATION_DEFAULTS.dailyDigest,
      runHour: row?.runHour ?? AUTOMATION_DEFAULTS.runHour,
      quoteNoAnswerDays: row?.quoteNoAnswerDays ?? AUTOMATION_DEFAULTS.quoteNoAnswerDays,
      digestEmail: row?.digestEmail ?? null,
      workerEnabled: this.deps.env.JOBS_ENABLED,
      updatedAt: row?.updatedAt?.toISOString() ?? null,
    };
  }

  async updateSettings(
    auth: AuthContext,
    input: UpdateAutomationSettingsInput,
    client: ClientInfo,
  ): Promise<AutomationsOverview> {
    await withTenant(this.deps.db, auth, async (tx) => {
      await repo.upsertSettings(tx, auth.organizationId, input);
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'automations.updated',
        entityType: 'automation_settings',
        entityId: auth.organizationId,
        ...client,
      });
    });
    return this.overview(auth);
  }

  // ------------------------------ execução -------------------------------

  /** "Rodar agora": a oficina não espera o amanhecer para ver a automação agir. */
  async runNow(auth: AuthContext, key: AutomationKey, client: ClientInfo): Promise<AutomationsOverview> {
    await this.executar(auth.organizationId, key, { forcar: true });
    await withTenant(this.deps.db, auth, async (tx) => {
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'automations.run',
        entityType: 'automation_settings',
        entityId: auth.organizationId,
        metadata: { key },
        ...client,
      });
    });
    return this.overview(auth);
  }

  /**
   * A volta do trabalhador de fundo: para cada oficina ativa, cada automação
   * ligada que ainda não rodou hoje. Erro numa oficina não derruba as outras —
   * ele fica gravado na execução dela.
   */
  async tick(apenas?: string): Promise<{ organizations: number; ran: number }> {
    const todas = await withJobRunner(this.deps.db, (tx) => repo.activeOrganizations(tx));
    // `apenas` existe para o teste (e para o suporte) olharem UMA oficina sem
    // esperar a volta inteira do banco de oficinas
    const oficinas = apenas ? todas.filter((oficina) => oficina.id === apenas) : todas;
    let ran = 0;
    for (const oficina of oficinas) {
      for (const key of ORDEM_DAS_AUTOMACOES) {
        try {
          const rodou = await this.executar(oficina.id, key, { forcar: false });
          if (rodou) ran += 1;
        } catch (erro) {
          this.deps.log.error({ err: erro, organizationId: oficina.id, key }, 'automação falhou');
        }
      }
    }
    return { organizations: oficinas.length, ran };
  }

  /** Roda UMA automação de UMA oficina, com registro do que aconteceu. */
  private async executar(organizationId: string, key: AutomationKey, opcoes: { forcar: boolean }): Promise<boolean> {
    const auth = { organizationId };
    const contexto = await withTenant(this.deps.db, auth, async (tx) => {
      const oficina = await orgRepo.findOrganization(tx, organizationId);
      if (!oficina) return null;
      const settings = await this.readSettings(tx, organizationId);
      const hoje = dayKey(new Date(), oficina.timezone);
      const jaRodou = await repo.ranOn(tx, organizationId, key, hoje);
      return { oficina, settings, hoje, jaRodou };
    });
    if (!contexto) return false;
    const { oficina, settings, hoje, jaRodou } = contexto;

    const ligada = {
      FOLLOW_UP_QUEUE: settings.followUpQueue,
      APPOINTMENT_REMINDER: settings.appointmentReminder,
      QUOTE_NO_ANSWER: settings.quoteNoAnswer,
      DAILY_DIGEST: settings.dailyDigest,
    }[key];
    if (!opcoes.forcar) {
      if (!ligada) return false;
      const naHora = deveRodarAgora({
        horaAgora: horaNaOficina(oficina.timezone),
        horaEscolhida: settings.runHour,
        ultimaExecucaoEm: jaRodou ? hoje : null,
        hoje,
      });
      if (!naHora) return false;
    }

    const comecou = Date.now();
    let created = 0;
    let erro: string | null = null;
    try {
      created = await withTenant(this.deps.db, auth, async (tx) => {
        switch (key) {
          case 'FOLLOW_UP_QUEUE':
            return this.filaDePosVenda(tx, organizationId, hoje);
          case 'APPOINTMENT_REMINDER':
            return this.lembreteDeAgendamento(tx, organizationId, oficina.timezone);
          case 'QUOTE_NO_ANSWER':
            return this.orcamentoSemResposta(tx, organizationId, settings.quoteNoAnswerDays);
          case 'DAILY_DIGEST':
            return this.resumoDoDia(tx, organizationId, oficina, settings, hoje);
        }
      });
    } catch (falha) {
      erro = falha instanceof Error ? falha.message : String(falha);
      this.deps.log.error({ err: falha, organizationId, key }, 'automação falhou');
    }

    await withTenant(this.deps.db, auth, async (tx) =>
      repo.insertRun(tx, {
        organizationId,
        key,
        ranOn: hoje,
        created,
        durationMs: Date.now() - comecou,
        error: erro,
      }),
    );
    return erro === null;
  }

  // --------------------------- cada automação ----------------------------

  /** A fila do dia: a MESMA conta que a tela faz ao abrir (D34). */
  private async filaDePosVenda(tx: Tx, organizationId: string, hoje: string): Promise<number> {
    const criados = await sincronizarFilaDePosVenda(tx, organizationId, hoje);
    if (!criados) return 0;
    const equipe = await repo.watchers(tx, organizationId);
    return repo.insertNotifications(
      tx,
      equipe.map((userId) => ({
        organizationId,
        userId,
        type: 'FOLLOW_UP_DUE' as const,
        title: criados === 1 ? '1 contato de pós-venda para hoje' : `${criados} contatos de pós-venda para hoje`,
        body: 'A fila do dia está pronta, com a mensagem escrita para cada cliente.',
        link: '/pos-venda',
      })),
    );
  }

  /** Amanhã tem carro chegando: quem ainda não confirmou vira aviso hoje. */
  private async lembreteDeAgendamento(tx: Tx, organizationId: string, timezone: string): Promise<number> {
    const { de, ate } = janelaDeAmanha(timezone);
    const { total, primeiro } = await repo.agendamentosDeAmanha(tx, organizationId, de, ate);
    if (!total) return 0;
    const equipe = await repo.watchers(tx, organizationId);
    return repo.insertNotifications(
      tx,
      equipe.map((userId) => ({
        organizationId,
        userId,
        type: 'APPOINTMENT_TOMORROW' as const,
        title: total === 1 ? '1 agendamento amanhã sem confirmar' : `${total} agendamentos amanhã sem confirmar`,
        body: primeiro ? `Começando por ${primeiro}. Confirme para o carro não faltar.` : null,
        link: '/agenda',
      })),
    );
  }

  /** Orçamento enviado que ficou parado: o dinheiro está esperando resposta. */
  private async orcamentoSemResposta(tx: Tx, organizationId: string, dias: number): Promise<number> {
    const limite = new Date(Date.now() - dias * 86_400_000);
    const parados = await repo.orcamentosParados(tx, organizationId, limite);
    if (!parados.length) return 0;
    const equipe = await repo.watchers(tx, organizationId);
    const avisos = parados.flatMap((orcamento) =>
      equipe.map((userId) => ({
        organizationId,
        userId,
        type: 'QUOTE_NO_ANSWER' as const,
        title: `Orçamento ${orcamento.number} sem resposta há ${dias} dias`,
        body:
          orcamento.viewCount === 0
            ? `${orcamento.customerName} ainda não abriu o link.`
            : `${orcamento.customerName} abriu o link, mas não respondeu.`,
        link: `/orcamentos/${orcamento.id}`,
        quoteId: orcamento.id,
        workOrderId: orcamento.workOrderId,
      })),
    );
    return repo.insertNotifications(tx, avisos);
  }

  /** O resumo por e-mail. Dia sem nada a dizer não vira e-mail nenhum. */
  private async resumoDoDia(
    tx: Tx,
    organizationId: string,
    oficina: { name: string; email: string | null; timezone: string },
    settings: AutomationSettings,
    hoje: string,
  ): Promise<number> {
    // para onde o resumo vai: o endereço escolhido, o e-mail da oficina, ou o
    // do dono — o e-mail que existe desde o cadastro, para o resumo não
    // depender de alguém ter preenchido a ficha da oficina
    const destino = settings.digestEmail ?? oficina.email ?? (await repo.ownerEmail(tx, organizationId));
    if (!destino) return 0;

    const numeros = await repo.numerosDoDia(tx, organizationId, hoje);
    const { de, ate } = janelaDeAmanha(oficina.timezone);
    const amanha = await repo.agendamentosDeAmanha(tx, organizationId, de, ate);
    const parados = await repo.orcamentosParados(
      tx,
      organizationId,
      new Date(Date.now() - settings.quoteNoAnswerDays * 86_400_000),
    );

    const resumo = {
      shopName: oficina.name,
      contatosHoje: numeros.contatosHoje,
      agendamentosAmanha: amanha.total,
      orcamentosParados: parados.length,
      entregasAtrasadas: numeros.entregasAtrasadas,
      aReceberVencidoCents: numeros.aReceberVencidoCents,
      appUrl: this.deps.env.APP_URL,
    };
    if (!temAlgoARelatar(resumo)) return 0;

    await this.deps.email.send({
      to: destino,
      subject: assuntoDoResumoDiario(resumo),
      text: textoDoResumoDiario(resumo),
    });
    return 1;
  }
}
