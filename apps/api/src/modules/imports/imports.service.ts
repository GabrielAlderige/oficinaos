import { and, eq, isNull, sql, TransactionRollbackError } from 'drizzle-orm';
import {
  canonicalPlate,
  IMPORT_COLUMNS,
  IMPORT_KIND_LABELS,
  IMPORT_KINDS,
  isValidCnpj,
  isValidCpf,
  normalizeBrazilianPhone,
  normalizeCnpj,
  normalizeCpf,
  parseCsv,
  parseCsvMoney,
  type ImportKind,
  type ImportProblem,
  type ImportRequest,
  type ImportResult,
} from '@oficinaos/shared';
import { recordActivity } from '../../core/audit';
import type { AuthContext, ClientInfo, ServiceDeps } from '../../core/auth-context';
import { AppError } from '../../core/errors';
import { ErrorCode } from '@oficinaos/shared';
import { customers, partCategories, parts, vehicles } from '../../db/schema';
import type { Tx } from '../../db/tenant';
import { withTenant } from '../../db/tenant';

/** Colunas aceitas, na ordem de preferência (o cabeçalho chega sem acento). */
const COL = {
  nome: ['nome', 'cliente', 'razaosocial', 'name'],
  whatsapp: ['whatsapp', 'celular', 'telefone', 'fone', 'phone'],
  telefone: ['telefone', 'fone', 'telefonefixo'],
  email: ['email', 'mail'],
  documento: ['documento', 'cpf', 'cnpj', 'cpfcnpj'],
  observacoes: ['observacoes', 'obs', 'notas', 'notes'],
  placa: ['placa', 'plate'],
  marca: ['marca', 'fabricante', 'make'],
  modelo: ['modelo', 'model'],
  ano: ['ano', 'anofabricacao', 'year'],
  anomodelo: ['anomodelo', 'modelyear'],
  cor: ['cor', 'color'],
  km: ['km', 'quilometragem', 'odometro'],
  chassi: ['chassi', 'vin'],
  clienteRef: ['cliente', 'proprietario', 'dono'],
  sku: ['sku', 'codigointerno'],
  codigo: ['codigo', 'codigofabricante', 'referencia', 'ref', 'partnumber'],
  categoria: ['categoria', 'grupo'],
  preco: ['preco', 'precovenda', 'venda', 'price'],
  custo: ['custo', 'precocusto', 'cost'],
  quantidade: ['quantidade', 'estoque', 'saldo', 'qtd'],
  minimo: ['minimo', 'estoqueminimo', 'min'],
  unidade: ['unidade', 'un', 'unit'],
} as const;

const pegar = (linha: Record<string, string>, chaves: readonly string[]): string =>
  chaves.map((chave) => linha[chave]).find((valor) => valor !== undefined && valor !== '')?.trim() ?? '';

const MAX_LINHAS = 5_000;
const MAX_PROBLEMAS = 50;

/**
 * Importação de planilha (E17). A oficina que sai de outro sistema — ou do
 * caderno — chega com CSV, e digitar tudo de novo é o que faz ela desistir.
 *
 * Duas regras que valem para as três importações:
 * 1. **Conferir antes de gravar.** `dryRun` é o padrão: a tela mostra o que
 *    vai acontecer, e só então a pessoa confirma.
 * 2. **Linha ruim não derruba o arquivo.** Ela volta com o número da linha e o
 *    motivo — recusar 2.000 clientes porque um CPF está errado é o tipo de
 *    rigor que só atrapalha.
 */
export class ImportsService {
  constructor(private readonly deps: ServiceDeps) {}

  /** O que cada importação aceita: a tela mostra isso antes de pedir o arquivo. */
  formats() {
    return {
      data: IMPORT_KINDS.map((kind) => ({
        kind,
        label: IMPORT_KIND_LABELS[kind],
        required: IMPORT_COLUMNS[kind].obrigatorias,
        optional: IMPORT_COLUMNS[kind].opcionais,
      })),
    };
  }

  async run(auth: AuthContext, kind: ImportKind, input: ImportRequest, client: ClientInfo): Promise<ImportResult> {
    const { rows } = parseCsv(input.csv);
    if (!rows.length) {
      throw new AppError(
        422,
        ErrorCode.VALIDATION_FAILED,
        'Planilha vazia',
        'O arquivo não tem nenhuma linha depois do cabeçalho.',
      );
    }
    if (rows.length > MAX_LINHAS) {
      throw new AppError(
        422,
        ErrorCode.VALIDATION_FAILED,
        'Planilha grande demais',
        `São ${rows.length.toLocaleString('pt-BR')} linhas; o limite é ${MAX_LINHAS.toLocaleString('pt-BR')} por vez. Divida o arquivo.`,
      );
    }

    const resultado: ImportResult = {
      kind,
      dryRun: input.dryRun,
      total: rows.length,
      created: 0,
      updated: 0,
      skipped: 0,
      problems: [],
      preview: [],
    };

    try {
      await withTenant(this.deps.db, auth, async (tx) => {
        for (const [indice, linha] of rows.entries()) {
          // +2: a linha 1 é o cabeçalho, e a pessoa conta a partir de 1
          const numeroDaLinha = indice + 2;
          try {
            const efeito =
              kind === 'customers'
                ? await this.cliente(tx, auth, linha, input.dryRun, resultado)
                : kind === 'vehicles'
                  ? await this.veiculo(tx, auth, linha, input.dryRun, resultado)
                  : await this.peca(tx, auth, linha, input.dryRun, resultado);
            if (efeito === 'created') resultado.created += 1;
            else if (efeito === 'updated') resultado.updated += 1;
            else resultado.skipped += 1;
          } catch (erro) {
            resultado.skipped += 1;
            empurrar(resultado.problems, {
              line: numeroDaLinha,
              reason: erro instanceof AppError ? (erro.detail ?? erro.title) : 'não foi possível importar esta linha',
              value: pegar(linha, COL.nome) || pegar(linha, COL.placa) || null,
            });
          }
        }

        /**
         * No ensaio, a transação inteira é desfeita: a conferência não grava
         * NADA — nem cliente, nem auditoria. É o que faz "conferir antes" ser
         * seguro de verdade, em vez de um relatório que já mexeu no banco.
         */
        if (input.dryRun) tx.rollback();

        await recordActivity(tx, {
          organizationId: auth.organizationId,
          actorUserId: auth.userId,
          action: 'import.executed',
          // a importação não é uma entidade com id próprio: o tipo do arquivo
          // vai no `entityType` (a coluna `entity_id` é uuid) e o alvo é a oficina
          entityType: `import:${kind}`,
          entityId: auth.organizationId,
          metadata: {
            kind: IMPORT_KIND_LABELS[kind],
            total: resultado.total,
            created: resultado.created,
            updated: resultado.updated,
            skipped: resultado.skipped,
          },
          ...client,
        });
      });
    } catch (erro) {
      // o `rollback()` do Drizzle sinaliza o desfazer com uma exceção própria:
      // no ensaio, esse é o caminho feliz (o `name` dela é 'DrizzleError', então
      // a checagem é pela CLASSE, não pelo nome)
      if (!(erro instanceof TransactionRollbackError)) throw erro;
    }
    return resultado;
  }

  // ------------------------------- clientes -------------------------------

  private async cliente(
    tx: Tx,
    auth: AuthContext,
    linha: Record<string, string>,
    dryRun: boolean,
    resultado: ImportResult,
  ): Promise<'created' | 'updated' | 'skipped'> {
    const nome = pegar(linha, COL.nome);
    if (nome.length < 2) throw problema('sem nome');

    const documentoBruto = pegar(linha, COL.documento);
    const documento = documentoBruto ? normalizarDocumento(documentoBruto) : null;
    if (documentoBruto && !documento) throw problema(`documento inválido: "${documentoBruto}"`);

    const whatsapp = telefone(pegar(linha, COL.whatsapp));
    const email = pegar(linha, COL.email).toLowerCase() || null;

    if (resultado.preview.length < 10) {
      resultado.preview.push({ nome, documento: documento ?? '', whatsapp: whatsapp ?? '', email: email ?? '' });
    }

    // o mesmo documento já cadastrado é a MESMA pessoa: atualiza, não duplica
    const existente = documento
      ? (
          await tx
            .select({ id: customers.id })
            .from(customers)
            .where(
              and(eq(customers.organizationId, auth.organizationId), eq(customers.document, documento), isNull(customers.deletedAt)),
            )
            .limit(1)
        )[0]
      : undefined;

    if (dryRun) return existente ? 'updated' : 'created';

    if (existente) {
      await tx
        .update(customers)
        .set({ name: nome, whatsapp: whatsapp ?? undefined, email: email ?? undefined })
        .where(eq(customers.id, existente.id));
      return 'updated';
    }
    await tx.insert(customers).values({
      organizationId: auth.organizationId,
      name: nome,
      document: documento,
      whatsapp,
      phone: telefone(pegar(linha, COL.telefone)),
      email,
      notes: pegar(linha, COL.observacoes) || null,
      createdBy: auth.userId,
    });
    return 'created';
  }

  // ------------------------------- veículos -------------------------------

  private async veiculo(
    tx: Tx,
    auth: AuthContext,
    linha: Record<string, string>,
    dryRun: boolean,
    resultado: ImportResult,
  ): Promise<'created' | 'updated' | 'skipped'> {
    const placaBruta = pegar(linha, COL.placa);
    const canonica = canonicalPlate(placaBruta);
    if (!canonica) throw problema(placaBruta ? `placa inválida: "${placaBruta}"` : 'sem placa');
    const marca = pegar(linha, COL.marca);
    const modelo = pegar(linha, COL.modelo);
    if (!marca || !modelo) throw problema('faltou marca ou modelo');

    const dono = await this.acharCliente(tx, auth.organizationId, linha);
    if (!dono) throw problema(`cliente não encontrado: "${pegar(linha, COL.clienteRef) || pegar(linha, COL.documento)}"`);

    if (resultado.preview.length < 10) {
      resultado.preview.push({ placa: placaBruta.toUpperCase(), marca, modelo, cliente: dono.name });
    }

    const existente = (
      await tx
        .select({ id: vehicles.id })
        .from(vehicles)
        .where(
          and(
            eq(vehicles.organizationId, auth.organizationId),
            eq(vehicles.plateCanonical, canonica),
            isNull(vehicles.deletedAt),
          ),
        )
        .limit(1)
    )[0];

    if (dryRun) return existente ? 'updated' : 'created';
    if (existente) {
      await tx.update(vehicles).set({ make: marca, model: modelo }).where(eq(vehicles.id, existente.id));
      return 'updated';
    }

    const ano = inteiro(pegar(linha, COL.ano));
    await tx.insert(vehicles).values({
      organizationId: auth.organizationId,
      customerId: dono.id,
      plate: placaBruta.toUpperCase().replace(/[^A-Z0-9]/g, ''),
      plateCanonical: canonica,
      make: marca,
      model: modelo,
      color: pegar(linha, COL.cor) || null,
      yearManufacture: ano,
      yearModel: inteiro(pegar(linha, COL.anomodelo)) ?? ano,
      odometerKm: inteiro(pegar(linha, COL.km)),
      vin: pegar(linha, COL.chassi).toUpperCase() || null,
      createdBy: auth.userId,
    });
    return 'created';
  }

  /** O dono pelo documento, pelo telefone ou pelo nome exato — nessa ordem. */
  private async acharCliente(tx: Tx, organizationId: string, linha: Record<string, string>) {
    const documento = normalizarDocumento(pegar(linha, COL.documento));
    if (documento) {
      const [achado] = await tx
        .select({ id: customers.id, name: customers.name })
        .from(customers)
        .where(and(eq(customers.organizationId, organizationId), eq(customers.document, documento), isNull(customers.deletedAt)))
        .limit(1);
      if (achado) return achado;
    }
    const fone = telefone(pegar(linha, COL.telefone) || pegar(linha, COL.whatsapp));
    if (fone) {
      const [achado] = await tx
        .select({ id: customers.id, name: customers.name })
        .from(customers)
        .where(
          and(
            eq(customers.organizationId, organizationId),
            sql`(${customers.whatsapp} = ${fone} or ${customers.phone} = ${fone})`,
            isNull(customers.deletedAt),
          ),
        )
        .limit(1);
      if (achado) return achado;
    }
    const nome = pegar(linha, COL.clienteRef);
    if (nome.length >= 2) {
      const [achado] = await tx
        .select({ id: customers.id, name: customers.name })
        .from(customers)
        .where(
          and(
            eq(customers.organizationId, organizationId),
            sql`immutable_unaccent(lower(${customers.name})) = immutable_unaccent(lower(${nome}))`,
            isNull(customers.deletedAt),
          ),
        )
        .limit(1);
      if (achado) return achado;
    }
    return null;
  }

  // --------------------------------- peças ---------------------------------

  private async peca(
    tx: Tx,
    auth: AuthContext,
    linha: Record<string, string>,
    dryRun: boolean,
    resultado: ImportResult,
  ): Promise<'created' | 'updated' | 'skipped'> {
    const nome = pegar(linha, COL.nome);
    if (nome.length < 2) throw problema('sem nome');
    const sku = pegar(linha, COL.sku) || null;
    const preco = parseCsvMoney(pegar(linha, COL.preco));
    const custo = parseCsvMoney(pegar(linha, COL.custo));

    if (resultado.preview.length < 10) {
      resultado.preview.push({
        nome,
        sku: sku ?? '',
        preco: preco === null ? '' : (preco / 100).toFixed(2),
        quantidade: pegar(linha, COL.quantidade) || '0',
      });
    }

    const existente = sku
      ? (
          await tx
            .select({ id: parts.id })
            .from(parts)
            .where(and(eq(parts.organizationId, auth.organizationId), eq(parts.sku, sku), isNull(parts.deletedAt)))
            .limit(1)
        )[0]
      : undefined;

    if (dryRun) return existente ? 'updated' : 'created';

    if (existente) {
      await tx
        .update(parts)
        .set({ name: nome, salePriceCents: preco ?? undefined })
        .where(eq(parts.id, existente.id));
      return 'updated';
    }

    const categoria = pegar(linha, COL.categoria);
    const categoriaId = categoria ? await this.acharCategoria(tx, auth.organizationId, categoria) : null;
    const quantidade = numero(pegar(linha, COL.quantidade));
    await tx.insert(parts).values({
      organizationId: auth.organizationId,
      name: nome,
      sku,
      manufacturerCode: pegar(linha, COL.codigo) || null,
      manufacturer: pegar(linha, COL.marca) || null,
      categoryId: categoriaId,
      salePriceCents: preco,
      // o estoque inicial entra como saldo e custo médio; o livro-razão da E4
      // continua sendo a verdade dali para a frente
      quantityOnHand: quantidade === null ? '0' : quantidade.toFixed(3),
      averageCostCents: custo,
      lastCostCents: custo,
      minQuantity: (numero(pegar(linha, COL.minimo)) ?? 0).toFixed(3),
      createdBy: auth.userId,
    });
    return 'created';
  }

  private async acharCategoria(tx: Tx, organizationId: string, nome: string): Promise<string | null> {
    const [achada] = await tx
      .select({ id: partCategories.id })
      .from(partCategories)
      .where(
        and(
          eq(partCategories.organizationId, organizationId),
          sql`immutable_unaccent(lower(${partCategories.name})) = immutable_unaccent(lower(${nome}))`,
        ),
      )
      .limit(1);
    return achada?.id ?? null;
  }
}

function empurrar(lista: ImportProblem[], problema: ImportProblem) {
  if (lista.length < MAX_PROBLEMAS) lista.push(problema);
}

const problema = (motivo: string) => new AppError(422, ErrorCode.VALIDATION_FAILED, 'Linha inválida', motivo);

const telefone = (valor: string): string | null => (valor ? normalizeBrazilianPhone(valor) : null);

function normalizarDocumento(valor: string): string | null {
  if (!valor) return null;
  const cpf = normalizeCpf(valor);
  if (isValidCpf(cpf)) return cpf;
  const cnpj = normalizeCnpj(valor);
  return isValidCnpj(cnpj) ? cnpj : null;
}

const inteiro = (valor: string): number | null => {
  const numero = Number(valor.replace(/\D/g, ''));
  return Number.isFinite(numero) && numero > 0 ? numero : null;
};

const numero = (valor: string): number | null => {
  if (!valor) return null;
  const convertido = Number(valor.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(convertido) ? convertido : null;
};
