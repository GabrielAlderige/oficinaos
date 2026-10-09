import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import {
  PROSPECT_SOURCE_LABELS,
  type CreateProspectInput,
  type Prospect,
  type ProspectsOverview,
  type UpdateProspectInput,
} from '@oficinaos/shared';
import type { ClientInfo, ServiceDeps } from '../../core/auth-context';
import { notFound } from '../../core/errors';
import { prospects } from '../../db/schema';
import { withoutTenant } from '../../db/tenant';

/** Data no formato que o Excel brasileiro entende sem reclamar. */
const dataBR = (valor: Date | null): string =>
  valor
    ? new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(valor)
    : '';

/** (35) 99841-6972 — é assim que se lê no WhatsApp. */
function telefoneLegivel(digitos: string): string {
  if (digitos.length === 11) return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 7)}-${digitos.slice(7)}`;
  if (digitos.length === 10) return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 6)}-${digitos.slice(6)}`;
  return digitos;
}

/**
 * Interessados vindos da landing (E42).
 *
 * A rota de gravar é **pública** — é o formulário do site. Três coisas
 * seguram o abuso, sem CAPTCHA (que derrubaria a conversão de quem é de
 * verdade): limite por IP na rota, o campo-armadilha `website`, e o banco, que
 * não dá UPDATE nem DELETE para a role da aplicação. O pior que um robô
 * consegue é sujar a lista; nunca apagar o que já entrou.
 */
export class ProspectsService {
  constructor(private readonly deps: ServiceDeps) {}

  /**
   * Grava o interessado. Devolve `true` mesmo quando é robô: dizer "recusado"
   * ensina o robô a contornar, e quem preenche de verdade nunca vê diferença.
   */
  async create(input: CreateProspectInput, client: ClientInfo): Promise<void> {
    const dados = input as Required<CreateProspectInput>;
    if (dados.website) {
      this.deps.log.info({ ip: client.ip }, 'interessado descartado pelo campo-armadilha');
      return;
    }

    await withoutTenant(this.deps.db, (tx) =>
      tx.insert(prospects).values({
        name: dados.name,
        phone: dados.phone,
        email: dados.email ?? '',
        workshopName: dados.workshopName ?? '',
        message: dados.message ?? '',
        source: dados.source ?? 'LANDING',
        ip: client.ip,
        userAgent: client.userAgent,
      }),
    );
    this.deps.log.info({ source: dados.source }, 'interessado novo');
    await this.avisar(dados);
  }

  /**
   * Interessado que espera esfria: avisa na hora quem vai ligar, com o link
   * que já abre a conversa no WhatsApp. Falha de e-mail não derruba o
   * cadastro, que já está gravado e aparece na tela da plataforma.
   */
  private async avisar(dados: Required<CreateProspectInput>): Promise<void> {
    const para = (this.deps.env.AVISO_INTERESSADOS ?? '')
      .split(',')
      .map((endereco) => endereco.trim())
      .filter(Boolean);
    if (!para.length) return;
    const digitos = dados.phone.replace(/\D/g, '');
    const whatsapp = `https://wa.me/${digitos.length <= 11 ? `55${digitos}` : digitos}`;
    const linhas = [
      `${dados.name} quer conhecer o OficinaOS.`,
      '',
      `Oficina: ${dados.workshopName || '(não informou)'}`,
      `Telefone: ${telefoneLegivel(digitos)}`,
      `WhatsApp: ${whatsapp}`,
      dados.email ? `E-mail: ${dados.email}` : '',
      dados.message ? `\nMensagem:\n${dados.message}` : '',
      '',
      `Veio de: ${PROSPECT_SOURCE_LABELS[dados.source ?? 'LANDING'] ?? dados.source}`,
      `Todos os interessados: ${this.deps.env.APP_URL}/plataforma/interessados`,
    ].filter((linha, i, todas) => linha !== '' || todas[i - 1] !== '');
    for (const endereco of para) {
      try {
        await this.deps.email.send({
          to: endereco,
          subject: `Interessado novo: ${dados.name}${dados.workshopName ? ` (${dados.workshopName})` : ''}`,
          text: linhas.join('\n'),
        });
      } catch (err) {
        this.deps.log.error({ err }, 'aviso de interessado novo falhou');
      }
    }
  }

  async overview(): Promise<ProspectsOverview> {
    const seteDiasAtras = new Date(Date.now() - 7 * 86_400_000);
    return withoutTenant(this.deps.db, async (tx) => {
      const linhas = await tx.select().from(prospects).orderBy(desc(prospects.createdAt)).limit(500);
      const [espera] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(prospects)
        .where(isNull(prospects.contactedAt));
      const [semana] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(prospects)
        .where(gte(prospects.createdAt, seteDiasAtras));
      const [tudo] = await tx.select({ total: sql<number>`count(*)::int` }).from(prospects);

      return {
        prospects: linhas.map(
          (linha): Prospect => ({
            id: linha.id,
            name: linha.name,
            phone: linha.phone,
            email: linha.email,
            workshopName: linha.workshopName,
            message: linha.message,
            source: linha.source,
            createdAt: linha.createdAt.toISOString(),
            contactedAt: linha.contactedAt?.toISOString() ?? null,
            notes: linha.notes,
          }),
        ),
        total: Number(tudo?.total ?? 0),
        aguardando: Number(espera?.total ?? 0),
        daSemana: Number(semana?.total ?? 0),
      };
    });
  }

  async update(id: string, input: UpdateProspectInput): Promise<Prospect> {
    const [linha] = await withoutTenant(this.deps.db, (tx) =>
      tx
        .update(prospects)
        .set({
          ...(input.contacted === undefined ? {} : { contactedAt: input.contacted ? new Date() : null }),
          ...(input.notes === undefined ? {} : { notes: input.notes }),
          updatedAt: new Date(),
        })
        .where(eq(prospects.id, id))
        .returning(),
    );
    if (!linha) throw notFound('Interessado não encontrado.');
    return {
      id: linha.id,
      name: linha.name,
      phone: linha.phone,
      email: linha.email,
      workshopName: linha.workshopName,
      message: linha.message,
      source: linha.source,
      createdAt: linha.createdAt.toISOString(),
      contactedAt: linha.contactedAt?.toISOString() ?? null,
      notes: linha.notes,
    };
  }

  /**
   * A planilha do remarketing.
   *
   * Ponto-e-vírgula e BOM porque é o que faz o Excel em português abrir o
   * arquivo já nas colunas certas — com vírgula ele joga tudo numa coluna só, e
   * sem BOM o acento vira caractere quebrado. É a mesma escolha dos relatórios.
   */
  async csv(): Promise<string> {
    const linhas = await withoutTenant(this.deps.db, (tx) =>
      tx.select().from(prospects).orderBy(desc(prospects.createdAt)),
    );
    const escapar = (valor: string) => `"${String(valor ?? '').replaceAll('"', '""')}"`;
    const cabecalho = ['Nome', 'WhatsApp', 'E-mail', 'Oficina', 'Mensagem', 'Origem', 'Entrou em', 'Contatado em', 'Observação'];
    const corpo = linhas.map((l) =>
      [
        l.name,
        telefoneLegivel(l.phone),
        l.email,
        l.workshopName,
        l.message.replaceAll('\n', ' '),
        PROSPECT_SOURCE_LABELS[l.source],
        dataBR(l.createdAt),
        dataBR(l.contactedAt),
        l.notes.replaceAll('\n', ' '),
      ]
        .map(escapar)
        .join(';'),
    );
    // o BOM entra como escape, não como caractere literal: literal no fonte é
    // espaço irregular e some em qualquer normalização de arquivo
    const BOM = String.fromCharCode(0xfeff);
    const FIM_DE_LINHA = String.fromCharCode(13, 10);
    return BOM + cabecalho.map(escapar).join(';') + FIM_DE_LINHA + corpo.join(FIM_DE_LINHA) + FIM_DE_LINHA;
  }

  /** Quantos ainda não foram chamados — o sino da plataforma usa isto. */
  async aguardando(): Promise<number> {
    const [linha] = await withoutTenant(this.deps.db, (tx) =>
      tx
        .select({ total: sql<number>`count(*)::int` })
        .from(prospects)
        .where(and(isNull(prospects.contactedAt))),
    );
    return Number(linha?.total ?? 0);
  }
}
