import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import {
  CFOP_PADRAO,
  computeApprovedTotals,
  ErrorCode,
  formaDePagamentoDaNota,
  icmsSituacaoDaNota,
  lineGrossCents,
  milliToDecimal,
  parseQuantity,
  pendenciasDaNotaDePecas,
  ratearDesconto,
  type PaymentMethod,
  type PricingLine,
  type ProductInvoice,
  type ProductInvoiceModel,
  type ProductInvoicePreview,
} from '@oficinaos/shared';
import { recordActivity } from '../../core/audit';
import type { AuthContext, ClientInfo, ServiceDeps } from '../../core/auth-context';
import { AppError, notFound } from '../../core/errors';
import { decifrar } from '../../core/secrets';
import {
  counterSaleItems,
  counterSales,
  customers,
  financialEntries,
  financialSettlements,
  parts,
  payments,
  productInvoiceItems,
  productInvoices,
  workOrderItems,
  workOrders,
} from '../../db/schema';
import { withTenant, type Tx } from '../../db/tenant';
import {
  SimuladorDeNotaDePecas,
  type EmissorDeNotaDePecas,
  type PedidoDeNotaDePecas,
  type RespostaDaNotaDePecas,
} from '../../integrations/fiscal/nota-de-pecas';
import * as orgRepo from '../organizations/organizations.repository';
import * as repo from './invoices.repository';

const milli = (valor: string) => parseQuantity(valor) ?? 0;
const SIMULADOR = new SimuladorDeNotaDePecas();

interface Origem {
  counterSaleId: string | null;
  workOrderId: string | null;
}

interface Montagem {
  itens: (PedidoDeNotaDePecas['itens'][number] & { partId: string; quantityMilli: number; totalCents: number })[];
  deFora: { description: string; reason: string }[];
  totalCents: number;
  pagamento: PaymentMethod | 'LATER' | null;
  cliente: { id: string; name: string; document: string | null; address: Record<string, string> | null } | null;
}

/**
 * Nota fiscal de peças (E50). Ver `packages/shared/src/product-invoices.ts`.
 *
 * Mesmo desenho da NFS-e (D37): a nota nasce na transação (com os itens
 * congelados), a chamada ao emissor acontece FORA dela — SEFAZ lenta não
 * prende o banco —, e a resposta é gravada numa transação nova.
 */
export class ProductInvoicesService {
  constructor(private readonly deps: ServiceDeps) {}

  /** O emissor da oficina: o de verdade quando a plataforma ligou a Focus, o simulador quando não. */
  private emissorPara(linha: Awaited<ReturnType<typeof repo.findFiscalSettings>>): EmissorDeNotaDePecas {
    const ligado =
      linha?.provider === 'focus' && linha.providerTokenEnc && (linha.environment === 'HOMOLOGATION' || linha.environment === 'PRODUCTION');
    if (!ligado) return SIMULADOR;
    return this.deps.emissorDePecasDaOficina({
      token: decifrar(linha!.providerTokenEnc!, this.deps.env.SECRETS_KEY),
      environment: linha!.environment as 'HOMOLOGATION' | 'PRODUCTION',
    });
  }

  async preview(auth: AuthContext, origem: Origem, modelo: ProductInvoiceModel): Promise<ProductInvoicePreview> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const montagem = await this.montar(tx, auth.organizationId, origem);
      const { pendencias, emissor } = await this.conferir(tx, auth.organizationId, modelo, montagem);
      return {
        model: modelo,
        environment: emissor.environment,
        items: montagem.itens.map(paraTela),
        totalCents: montagem.totalCents,
        leftOut: montagem.deFora,
        issues: pendencias,
      };
    });
  }

  async issue(
    auth: AuthContext,
    input: { clientRequestId: string; model: ProductInvoiceModel; counterSaleId: string | null; workOrderId: string | null },
    client: ClientInfo,
  ): Promise<ProductInvoice> {
    const preparado = await withTenant(this.deps.db, auth, async (tx) => {
      const [repetida] = await tx
        .select({ id: productInvoices.id })
        .from(productInvoices)
        .where(and(eq(productInvoices.organizationId, auth.organizationId), eq(productInvoices.clientRequestId, input.clientRequestId)))
        .limit(1);
      if (repetida) return { invoiceId: repetida.id, pedido: null, emissor: SIMULADOR };

      const montagem = await this.montar(tx, auth.organizationId, input);
      const { pendencias, emissor, pedidoBase } = await this.conferir(tx, auth.organizationId, input.model, montagem);
      if (pendencias.length) {
        throw new AppError(422, ErrorCode.VALIDATION_FAILED, 'Falta informação para a nota', pendencias.map((p) => p.mensagem).join(' '));
      }
      const viva = await tx
        .select({ id: productInvoices.id })
        .from(productInvoices)
        .where(
          and(
            eq(productInvoices.organizationId, auth.organizationId),
            input.counterSaleId ? eq(productInvoices.counterSaleId, input.counterSaleId) : eq(productInvoices.workOrderId, input.workOrderId!),
            inArray(productInvoices.status, ['QUEUED', 'AUTHORIZED']),
          ),
        )
        .limit(1);
      if (viva.length) {
        throw new AppError(409, ErrorCode.CONFLICT, 'Já tem nota', 'Esta venda já tem nota emitida ou em processamento. Cancele a nota para emitir outra.');
      }

      const [nota] = await tx
        .insert(productInvoices)
        .values({
          organizationId: auth.organizationId,
          model: input.model,
          status: 'QUEUED',
          environment: emissor.environment,
          provider: emissor.driver,
          counterSaleId: input.counterSaleId,
          workOrderId: input.workOrderId,
          customerId: montagem.cliente?.id ?? null,
          clientRequestId: input.clientRequestId,
          totalCents: montagem.totalCents,
          createdBy: auth.userId,
        })
        .returning();
      await tx.insert(productInvoiceItems).values(
        montagem.itens.map((item, position) => ({
          organizationId: auth.organizationId,
          invoiceId: nota!.id,
          partId: item.partId,
          description: item.descricao,
          ncm: item.ncm.replace(/\D/g, ''),
          cfop: item.cfop,
          unit: item.unidade,
          quantity: milliToDecimal(item.quantityMilli),
          unitPriceCents: item.valorUnitarioCents,
          discountCents: item.descontoCents,
          totalCents: item.totalCents,
          position,
        })),
      );
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'product_invoice.requested',
        entityType: 'product_invoice',
        entityId: nota!.id,
        metadata: { model: input.model, totalCents: montagem.totalCents, environment: emissor.environment },
        ...client,
      });
      return { invoiceId: nota!.id, pedido: { ...pedidoBase, invoiceId: nota!.id }, emissor };
    });

    if (preparado.pedido) {
      let resposta: RespostaDaNotaDePecas;
      try {
        resposta = await preparado.emissor.emitir(preparado.pedido);
      } catch (erro) {
        this.deps.log.error({ err: erro, invoiceId: preparado.invoiceId }, 'emissor da nota de peças falhou');
        resposta = {
          status: 'REJECTED',
          environment: preparado.emissor.environment,
          provider: preparado.emissor.driver,
          providerRef: preparado.invoiceId,
          number: null,
          series: null,
          accessKey: null,
          danfeUrl: null,
          xmlUrl: null,
          qrcodeUrl: null,
          issuedAt: null,
          rejectionReason: 'O emissor não respondeu. A nota não foi emitida; tente de novo.',
          raw: {},
        };
      }
      await this.gravar(auth, preparado.invoiceId, resposta);
    }
    return this.get(auth, preparado.invoiceId);
  }

  /** A nota; a NF-e que ficou na fila pergunta de novo ao emissor antes de responder. */
  async get(auth: AuthContext, id: string): Promise<ProductInvoice> {
    const nota = await withTenant(this.deps.db, auth, (tx) => this.achar(tx, auth.organizationId, id));
    if (nota.status === 'QUEUED' && nota.provider !== 'simulador') {
      const emissor = await withTenant(this.deps.db, auth, async (tx) => this.emissorPara(await repo.findFiscalSettings(tx, auth.organizationId)));
      try {
        await this.gravar(auth, id, await emissor.consultar({ modelo: nota.model, ref: nota.providerRef ?? id }));
      } catch (erro) {
        this.deps.log.warn({ err: erro, invoiceId: id }, 'consulta da nota de peças falhou; segue na fila');
      }
    }
    return withTenant(this.deps.db, auth, (tx) => this.carregar(tx, auth.organizationId, id));
  }

  async listFor(auth: AuthContext, origem: Origem): Promise<ProductInvoice[]> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const linhas = await tx
        .select({ id: productInvoices.id })
        .from(productInvoices)
        .where(
          and(
            eq(productInvoices.organizationId, auth.organizationId),
            origem.counterSaleId ? eq(productInvoices.counterSaleId, origem.counterSaleId) : eq(productInvoices.workOrderId, origem.workOrderId!),
          ),
        )
        .orderBy(desc(productInvoices.createdAt));
      const notas = [];
      for (const { id } of linhas) notas.push(await this.carregar(tx, auth.organizationId, id));
      return notas;
    });
  }

  /** Cancelar é na SEFAZ primeiro (NFC-e até 30 min, NF-e até 24 h); só depois a nota muda aqui. */
  async cancel(auth: AuthContext, id: string, motivo: string, client: ClientInfo): Promise<ProductInvoice> {
    const { nota, emissor } = await withTenant(this.deps.db, auth, async (tx) => ({
      nota: await this.achar(tx, auth.organizationId, id),
      emissor: this.emissorPara(await repo.findFiscalSettings(tx, auth.organizationId)),
    }));
    if (nota.status !== 'AUTHORIZED') {
      throw new AppError(422, ErrorCode.VALIDATION_FAILED, 'Nota não autorizada', 'Só nota autorizada se cancela.');
    }
    const quem = nota.provider === 'simulador' ? SIMULADOR : emissor;
    let resposta: Awaited<ReturnType<EmissorDeNotaDePecas['cancelar']>>;
    try {
      resposta = await quem.cancelar({ modelo: nota.model, ref: nota.providerRef ?? id, motivo: motivo.trim() });
    } catch (erro) {
      throw new AppError(
        422,
        ErrorCode.VALIDATION_FAILED,
        'A SEFAZ não cancelou',
        erro instanceof Error ? erro.message : 'Tente de novo em instantes. Passado o prazo, o cancelamento é com o contador.',
      );
    }
    return withTenant(this.deps.db, auth, async (tx) => {
      await tx
        .update(productInvoices)
        .set({
          status: 'CANCELED',
          canceledAt: resposta.canceledAt,
          cancelReason: motivo.trim(),
          canceledBy: auth.userId,
          providerResponse: resposta.raw,
          updatedAt: new Date(),
        })
        .where(eq(productInvoices.id, id));
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'product_invoice.canceled',
        entityType: 'product_invoice',
        entityId: id,
        metadata: { reason: motivo.trim() },
        ...client,
      });
      return this.carregar(tx, auth.organizationId, id);
    });
  }

  // ------------------------------------------------------------------ montagem

  /**
   * Os itens da nota: só PEÇA do catálogo. Da venda de balcão, as linhas com
   * peça; da OS, as peças aprovadas que a oficina forneceu. O desconto geral
   * é rateado entre elas na proporção do valor.
   */
  private async montar(tx: Tx, organizationId: string, origem: Origem): Promise<Montagem> {
    const deFora: Montagem['deFora'] = [];
    type Linha = { partId: string; description: string; quantityMilli: number; unitPriceCents: number; lineDiscount: number };
    const linhas: Linha[] = [];
    let descontoGeral: number;
    let clienteId: string | null;
    let pagamento: Montagem['pagamento'];

    if (origem.counterSaleId) {
      const [venda] = await tx
        .select()
        .from(counterSales)
        .where(and(eq(counterSales.organizationId, organizationId), eq(counterSales.id, origem.counterSaleId)))
        .limit(1);
      if (!venda) throw notFound('Venda não encontrada.');
      if (venda.status === 'CANCELED') throw new AppError(422, ErrorCode.VALIDATION_FAILED, 'Venda cancelada', 'Venda cancelada não tem nota.');
      clienteId = venda.customerId;
      const itens = await tx
        .select()
        .from(counterSaleItems)
        .where(and(eq(counterSaleItems.organizationId, organizationId), eq(counterSaleItems.saleId, venda.id)))
        .orderBy(asc(counterSaleItems.position));
      for (const item of itens) {
        if (!item.partId) {
          deFora.push({ description: item.description, reason: 'item avulso, sem peça do catálogo' });
          continue;
        }
        linhas.push({ partId: item.partId, description: item.description, quantityMilli: milli(item.quantity), unitPriceCents: item.unitPriceCents, lineDiscount: 0 });
      }
      // o desconto da venda é do total: a parte das peças sai na proporção delas no subtotal
      const subtotalDasPecas = linhas.reduce((s, l) => s + lineGrossCents(l.quantityMilli, l.unitPriceCents), 0);
      descontoGeral = venda.subtotalCents > 0 ? Math.round((venda.discountCents * subtotalDasPecas) / venda.subtotalCents) : 0;
      // como foi pago: a baixa da venda (ou fiado, se a conta ficou em aberto)
      const [baixa] = await tx
        .select({ method: financialSettlements.method })
        .from(financialSettlements)
        .innerJoin(financialEntries, and(eq(financialEntries.organizationId, financialSettlements.organizationId), eq(financialEntries.id, financialSettlements.entryId)))
        .where(and(eq(financialEntries.organizationId, organizationId), eq(financialEntries.counterSaleId, venda.id), eq(financialSettlements.status, 'CONFIRMED')))
        .limit(1);
      pagamento = baixa?.method ?? 'LATER';
    } else {
      const [os] = await tx
        .select()
        .from(workOrders)
        .where(and(eq(workOrders.organizationId, organizationId), eq(workOrders.id, origem.workOrderId!)))
        .limit(1);
      if (!os) throw notFound('OS não encontrada.');
      if (os.status === 'CANCELED') throw new AppError(422, ErrorCode.VALIDATION_FAILED, 'OS cancelada', 'OS cancelada não tem nota.');
      clienteId = os.customerId;
      const itens = await tx
        .select()
        .from(workOrderItems)
        .where(and(eq(workOrderItems.organizationId, organizationId), eq(workOrderItems.workOrderId, os.id)))
        .orderBy(asc(workOrderItems.position), asc(workOrderItems.createdAt));
      const aprovouAlgo = os.approvedTotalCents > 0;
      const valeNaNota = (i: (typeof itens)[number]) => (aprovouAlgo ? i.approvalStatus === 'APPROVED' : i.approvalStatus !== 'REJECTED');
      const linhasDePreco: PricingLine[] = itens.map((i) => ({
        type: i.type,
        quantityMilli: milli(i.quantity),
        unitPriceCents: i.unitPriceCents,
        discountCents: i.discountCents,
        isOptional: i.isOptional,
        approved: valeNaNota(i),
      }));
      const totais = computeApprovedTotals(linhasDePreco, { discountMode: os.discountMode, discountValue: os.discountValue, surchargeCents: 0 });
      for (const item of itens.filter(valeNaNota)) {
        if (item.type !== 'PART') continue;
        if (item.sourcing === 'CUSTOMER_PROVIDED') {
          deFora.push({ description: item.description, reason: 'peça trazida pelo cliente' });
          continue;
        }
        if (!item.partId) {
          deFora.push({ description: item.description, reason: 'peça sem cadastro no catálogo' });
          continue;
        }
        linhas.push({ partId: item.partId, description: item.description, quantityMilli: milli(item.quantity), unitPriceCents: item.unitPriceCents, lineDiscount: item.discountCents });
      }
      const liquidoDasPecas = linhas.reduce((s, l) => s + Math.max(0, lineGrossCents(l.quantityMilli, l.unitPriceCents) - l.lineDiscount), 0);
      const subtotalAprovado = totais.subtotalCents;
      descontoGeral = subtotalAprovado > 0 ? Math.round((totais.discountCents * liquidoDasPecas) / subtotalAprovado) : 0;
      const [pago] = await tx
        .select({ method: payments.method })
        .from(payments)
        .where(and(eq(payments.organizationId, organizationId), eq(payments.workOrderId, os.id), eq(payments.status, 'CONFIRMED')))
        .orderBy(desc(payments.amountCents))
        .limit(1);
      pagamento = pago?.method ?? null;
    }

    const ids = [...new Set(linhas.map((l) => l.partId))];
    const pecas = ids.length
      ? await tx.select().from(parts).where(and(eq(parts.organizationId, organizationId), inArray(parts.id, ids)))
      : [];
    const pecaDe = new Map(pecas.map((p) => [p.id, p]));
    const brutos = linhas.map((l) => Math.max(0, lineGrossCents(l.quantityMilli, l.unitPriceCents) - l.lineDiscount));
    const rateio = ratearDesconto(brutos, descontoGeral);
    const itens = linhas.map((l, i) => {
      const peca = pecaDe.get(l.partId);
      const bruto = lineGrossCents(l.quantityMilli, l.unitPriceCents);
      const desconto = l.lineDiscount + rateio[i]!;
      return {
        partId: l.partId,
        codigo: peca?.sku || peca?.manufacturerCode || l.partId.slice(0, 8),
        descricao: l.description,
        ncm: peca?.ncm ?? '',
        cfop: CFOP_PADRAO,
        unidade: peca?.unit ?? 'UN',
        quantidade: l.quantityMilli / 1000,
        quantityMilli: l.quantityMilli,
        valorUnitarioCents: l.unitPriceCents,
        brutoCents: bruto,
        descontoCents: Math.min(desconto, bruto),
        totalCents: Math.max(0, bruto - desconto),
      };
    });

    let cliente: Montagem['cliente'] = null;
    if (clienteId) {
      const [c] = await tx.select().from(customers).where(and(eq(customers.organizationId, organizationId), eq(customers.id, clienteId))).limit(1);
      if (c) cliente = { id: c.id, name: c.name, document: c.document, address: (c.address as Record<string, string> | null) ?? null };
    }
    return { itens, deFora, totalCents: itens.reduce((s, i) => s + i.totalCents, 0), pagamento, cliente };
  }

  private async conferir(tx: Tx, organizationId: string, modelo: ProductInvoiceModel, montagem: Montagem) {
    const fiscal = await repo.findFiscalSettings(tx, organizationId);
    const oficina = await orgRepo.findOrganization(tx, organizationId);
    const icms = icmsSituacaoDaNota(fiscal?.taxRegime ?? null, fiscal?.productIcmsSituation ?? null);
    const cfop = fiscal?.productCfop?.trim() || CFOP_PADRAO;
    const pendencias = pendenciasDaNotaDePecas({
      modelo,
      cnpjOficina: oficina?.document ?? null,
      inscricaoEstadual: fiscal?.stateRegistration ?? null,
      icmsSituacao: icms,
      itens: montagem.itens.map((i) => ({ nome: i.descricao, ncm: i.ncm })),
      cliente: montagem.cliente ? { documento: montagem.cliente.document, endereco: montagem.cliente.address } : null,
    });
    const e = montagem.cliente?.address;
    const pedidoBase: Omit<PedidoDeNotaDePecas, 'invoiceId'> = {
      modelo,
      emitente: { cnpj: oficina?.document ?? '', uf: oficina?.address?.state ?? null },
      destinatario: montagem.cliente
        ? {
            nome: montagem.cliente.name,
            documento: montagem.cliente.document,
            endereco:
              e?.street && e.number && e.district && e.city && e.state && e.zip
                ? { street: e.street, number: e.number, district: e.district, city: e.city, state: e.state, zip: e.zip }
                : null,
          }
        : null,
      icmsSituacao: icms ?? '',
      itens: montagem.itens.map((i) => ({ ...i, cfop })),
      pagamento: { forma: formaDePagamentoDaNota(montagem.pagamento), valorCents: montagem.totalCents },
      totalCents: montagem.totalCents,
      informacoesAdicionais: fiscal?.additionalInformation ?? null,
    };
    return { pendencias, emissor: this.emissorPara(fiscal), pedidoBase };
  }

  private async gravar(auth: AuthContext, id: string, resposta: RespostaDaNotaDePecas) {
    await withTenant(this.deps.db, auth, async (tx) => {
      await tx
        .update(productInvoices)
        .set({
          status: resposta.status,
          providerRef: resposta.providerRef,
          number: resposta.number,
          series: resposta.series,
          accessKey: resposta.accessKey,
          danfeUrl: resposta.danfeUrl,
          xmlUrl: resposta.xmlUrl,
          qrcodeUrl: resposta.qrcodeUrl,
          issuedAt: resposta.status === 'AUTHORIZED' ? (resposta.issuedAt ?? new Date()) : null,
          rejectionReason: resposta.rejectionReason,
          providerResponse: resposta.raw,
          updatedAt: new Date(),
        })
        .where(and(eq(productInvoices.organizationId, auth.organizationId), eq(productInvoices.id, id)));
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: resposta.status === 'AUTHORIZED' ? 'product_invoice.authorized' : resposta.status === 'REJECTED' ? 'product_invoice.rejected' : 'product_invoice.queued',
        entityType: 'product_invoice',
        entityId: id,
        metadata: { number: resposta.number, reason: resposta.rejectionReason },
      });
    });
  }

  private async achar(tx: Tx, organizationId: string, id: string) {
    const [nota] = await tx
      .select()
      .from(productInvoices)
      .where(and(eq(productInvoices.organizationId, organizationId), eq(productInvoices.id, id)))
      .limit(1);
    if (!nota) throw notFound('Nota não encontrada.');
    return nota;
  }

  private async carregar(tx: Tx, organizationId: string, id: string): Promise<ProductInvoice> {
    const nota = await this.achar(tx, organizationId, id);
    const itens = await tx
      .select()
      .from(productInvoiceItems)
      .where(and(eq(productInvoiceItems.organizationId, organizationId), eq(productInvoiceItems.invoiceId, id)))
      .orderBy(asc(productInvoiceItems.position));
    const [cliente] = nota.customerId
      ? await tx.select({ name: customers.name }).from(customers).where(and(eq(customers.organizationId, organizationId), eq(customers.id, nota.customerId))).limit(1)
      : [];
    return {
      id: nota.id,
      model: nota.model,
      status: nota.status,
      environment: nota.environment,
      counterSaleId: nota.counterSaleId,
      workOrderId: nota.workOrderId,
      customerName: cliente?.name ?? null,
      number: nota.number,
      series: nota.series,
      accessKey: nota.accessKey,
      danfeUrl: nota.danfeUrl,
      xmlUrl: nota.xmlUrl,
      qrcodeUrl: nota.qrcodeUrl,
      totalCents: nota.totalCents,
      rejectionReason: nota.rejectionReason,
      issuedAt: nota.issuedAt?.toISOString() ?? null,
      canceledAt: nota.canceledAt?.toISOString() ?? null,
      cancelReason: nota.cancelReason,
      createdAt: nota.createdAt.toISOString(),
      items: itens.map((i) => ({
        description: i.description,
        ncm: i.ncm,
        cfop: i.cfop,
        quantity: milli(i.quantity) / 1000,
        unitPriceCents: i.unitPriceCents,
        discountCents: i.discountCents,
        totalCents: i.totalCents,
      })),
    };
  }
}

const paraTela = (i: Montagem['itens'][number]) => ({
  description: i.descricao,
  ncm: i.ncm,
  cfop: i.cfop,
  quantity: i.quantidade,
  unitPriceCents: i.valorUnitarioCents,
  discountCents: i.descontoCents,
  totalCents: i.totalCents,
});

