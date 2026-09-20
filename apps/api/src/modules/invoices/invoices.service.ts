import {
  discriminacaoDosServicos,
  ErrorCode,
  computeApprovedTotals,
  computeTotals,
  lineTotalCents,
  parseQuantity,
  milliToNumber,
  pendenciasParaEmitir,
  totaisDaNota,
  type CancelInvoiceInput,
  type FiscalSettings,
  type Invoice,
  type InvoiceListQuery,
  type InvoicePreview,
  type IssueInvoiceInput,
  type Page,
  type PricingLine,
  type UpdateFiscalSettingsInput,
} from '@oficinaos/shared';
import { recordActivity } from '../../core/audit';
import type { AuthContext, ClientInfo, ServiceDeps } from '../../core/auth-context';
import { COUNTER_INVOICE_RPS, nextNumber } from '../../core/counters';
import { AppError, notFound } from '../../core/errors';
import { withTenant } from '../../db/tenant';
import type { Tx } from '../../db/tenant';
import * as customerRepo from '../customers/customers.repository';
import * as orgRepo from '../organizations/organizations.repository';
import * as workOrderRepo from '../work-orders/work-orders.repository';
import type { PedidoDeNfse } from '../../integrations/fiscal/nfse';
import * as repo from './invoices.repository';

const milli = (value: string) => parseQuantity(value) ?? 0;

/** Rateio: quanto do desconto da OS cabe à parte de serviços. */
function descontoDosServicos(descontoCents: number, servicosCents: number, subtotalCents: number): number {
  if (descontoCents <= 0 || subtotalCents <= 0) return 0;
  return Math.min(servicosCents, Math.round((descontoCents * servicosCents) / subtotalCents));
}

/**
 * Nota fiscal de serviço (V3, E18).
 *
 * Três decisões que explicam o resto do arquivo:
 *
 * 1. **A nota cobre só os SERVIÇOS.** Peça é nota de mercadoria (NF-e/NFC-e),
 *    que é etapa própria. A tela diz isso na cara, com o valor das peças ao
 *    lado, para ninguém achar que a nota "esqueceu" metade da OS.
 * 2. **O que entra na nota é o que o cliente paga**: se houve aprovação, os
 *    itens aprovados; se não houve (serviço fechado no balcão), a OS inteira.
 *    É a mesma regra do `devidoCents`, para nota e conta a receber nunca
 *    divergirem.
 * 3. **A chamada ao emissor acontece FORA da transação.** Prefeitura demora, e
 *    transação aberta esperando rede é o jeito mais rápido de travar o banco.
 *    A nota nasce `QUEUED`, a resposta chega depois e vira `AUTHORIZED` ou
 *    `REJECTED` — que é exatamente o que um emissor real faz.
 */
export class InvoicesService {
  constructor(private readonly deps: ServiceDeps) {}

  // ---------------------------- configuração -----------------------------

  async settings(auth: AuthContext): Promise<FiscalSettings> {
    return withTenant(this.deps.db, auth, async (tx) => this.readSettings(tx, auth.organizationId));
  }

  private async readSettings(tx: Tx, organizationId: string): Promise<FiscalSettings> {
    const row = await repo.findFiscalSettings(tx, organizationId);
    return {
      municipalRegistration: row?.municipalRegistration ?? null,
      stateRegistration: row?.stateRegistration ?? null,
      taxRegime: row?.taxRegime ?? null,
      cnae: row?.cnae ?? null,
      serviceListItem: row?.serviceListItem ?? null,
      municipalServiceCode: row?.municipalServiceCode ?? null,
      issRateBps: row?.issRateBps ?? null,
      issRetainedDefault: row?.issRetainedDefault ?? false,
      rpsSeries: row?.rpsSeries ?? '1',
      environment: row?.environment ?? this.deps.nfse.environment,
      provider: row?.provider ?? this.deps.nfse.driver,
      providerCompanyId: row?.providerCompanyId ?? null,
      additionalInformation: row?.additionalInformation ?? null,
      updatedAt: row?.updatedAt?.toISOString() ?? null,
    };
  }

  async updateSettings(auth: AuthContext, input: UpdateFiscalSettingsInput, client: ClientInfo): Promise<FiscalSettings> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const antes = await repo.findFiscalSettings(tx, auth.organizationId);
      await repo.upsertFiscalSettings(tx, auth.organizationId, {
        ...input,
        // o ambiente e o driver saem da configuração do servidor, não da tela:
        // ninguém "vira produção" clicando num campo do painel
        environment: this.deps.nfse.environment,
        provider: this.deps.nfse.driver,
      });
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: antes ? 'fiscal_settings.updated' : 'fiscal_settings.created',
        entityType: 'fiscal_settings',
        entityId: auth.organizationId,
        ...client,
      });
      return this.readSettings(tx, auth.organizationId);
    });
  }

  // ------------------------------- prévia --------------------------------

  async preview(auth: AuthContext, workOrderId: string): Promise<InvoicePreview> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const base = await this.montar(tx, auth.organizationId, workOrderId);
      const existente = await repo.findLiveByWorkOrder(tx, auth.organizationId, workOrderId);
      return {
        workOrderId,
        workOrderNumber: base.order.number,
        customerName: base.customer.name,
        customerDocument: base.customer.document,
        environment: this.deps.nfse.environment,
        serviceAmountCents: base.servicosCents,
        partsAmountCents: base.pecasCents,
        discountCents: base.descontoCents,
        baseAmountCents: base.totais.baseCalculoCents,
        issRateBps: base.issRateBps,
        issAmountCents: base.totais.issCents,
        issRetained: base.issRetido,
        totalCents: base.totais.totalCents,
        description: base.discriminacao,
        items: base.servicos.map((servico) => ({
          workOrderItemId: servico.workOrderItemId,
          description: servico.description,
          quantity: servico.quantity,
          unitPriceCents: servico.unitPriceCents,
          totalCents: servico.totalCents,
        })),
        pending: base.pendencias,
        existingInvoiceId: existente?.id ?? null,
      };
    });
  }

  // ------------------------------- emissão -------------------------------

  async issue(auth: AuthContext, workOrderId: string, input: IssueInvoiceInput, client: ClientInfo): Promise<Invoice> {
    const { invoiceId, pedido } = await withTenant(this.deps.db, auth, async (tx) => {
      const order = await workOrderRepo.lockWorkOrder(tx, auth.organizationId, workOrderId);
      if (!order) throw notFound('OS não encontrada.');

      // o mesmo POST repetido devolve a nota que já saiu (D32)
      const repetida = await repo.findByClientRequest(tx, auth.organizationId, input.clientRequestId);
      if (repetida) return { invoiceId: repetida.id, pedido: null };

      if (order.status !== 'COMPLETED' && order.status !== 'DELIVERED') {
        throw new AppError(
          422,
          ErrorCode.INVALID_TRANSITION,
          'O serviço ainda não terminou',
          'A nota sai depois de finalizar a OS: é ela que diz que o serviço foi prestado.',
        );
      }
      const viva = await repo.findLiveByWorkOrder(tx, auth.organizationId, workOrderId);
      if (viva) {
        throw new AppError(
          409,
          ErrorCode.CONFLICT,
          'Esta OS já tem nota',
          'Para emitir outra, cancele a nota atual primeiro.',
        );
      }

      const base = await this.montar(tx, auth.organizationId, workOrderId, input);
      if (base.pendencias.length) {
        throw new AppError(
          422,
          ErrorCode.VALIDATION_FAILED,
          'Faltam dados para emitir a nota',
          'Complete o que está marcado e tente de novo.',
          base.pendencias.map((pendencia) => ({ path: `${pendencia.onde}.${pendencia.campo}`, message: pendencia.mensagem })),
        );
      }

      const rpsNumber = await nextNumber(tx, auth.organizationId, COUNTER_INVOICE_RPS);
      const nota = await repo.insertInvoice(tx, {
        organizationId: auth.organizationId,
        kind: 'NFSE',
        status: 'QUEUED',
        environment: this.deps.nfse.environment,
        provider: this.deps.nfse.driver,
        workOrderId,
        customerId: base.customer.id,
        vehicleId: base.vehicle.id,
        rpsNumber,
        rpsSeries: base.settings.rpsSeries,
        clientRequestId: input.clientRequestId,
        serviceAmountCents: base.servicosCents,
        deductionsCents: base.deducoesCents,
        discountCents: base.descontoCents,
        baseAmountCents: base.totais.baseCalculoCents,
        issRateBps: base.issRateBps,
        issAmountCents: base.totais.issCents,
        issRetained: base.issRetido,
        irrfCents: input.irrfCents ?? 0,
        pisCents: input.pisCents ?? 0,
        cofinsCents: input.cofinsCents ?? 0,
        csllCents: input.csllCents ?? 0,
        inssCents: input.inssCents ?? 0,
        totalCents: base.totais.totalCents,
        netCents: base.totais.liquidoCents,
        description: base.discriminacao,
        createdBy: auth.userId,
      });
      await repo.insertInvoiceItems(
        tx,
        base.servicos.map((servico, index) => ({
          organizationId: auth.organizationId,
          invoiceId: nota.id,
          workOrderItemId: servico.workOrderItemId,
          description: servico.description,
          quantity: servico.quantity.toFixed(3),
          unitPriceCents: servico.unitPriceCents,
          totalCents: servico.totalCents,
          position: index + 1,
        })),
      );

      const pedido: PedidoDeNfse = {
        invoiceId: nota.id,
        rpsNumber,
        rpsSeries: nota.rpsSeries,
        prestador: {
          document: base.oficina.document ?? '',
          legalName: base.oficina.legalName ?? base.oficina.name,
          municipalRegistration: base.settings.municipalRegistration ?? '',
          city: base.oficina.address?.city ?? '',
          state: base.oficina.address?.state ?? '',
          taxRegime: base.settings.taxRegime ?? '',
          serviceListItem: base.settings.serviceListItem ?? '',
          municipalServiceCode: base.settings.municipalServiceCode,
          cnae: base.settings.cnae,
          providerCompanyId: base.settings.providerCompanyId,
        },
        tomador: {
          name: base.customer.name,
          document: base.customer.document,
          email: base.customer.email,
          zip: base.customer.address?.zip ?? null,
          street: base.customer.address?.street ?? null,
          number: base.customer.address?.number ?? null,
          complement: base.customer.address?.complement ?? null,
          district: base.customer.address?.district ?? null,
          city: base.customer.address?.city ?? null,
          state: base.customer.address?.state ?? null,
        },
        servicos: base.servicos.map((servico) => ({
          description: servico.description,
          quantity: servico.quantity,
          unitPriceCents: servico.unitPriceCents,
          totalCents: servico.totalCents,
        })),
        discriminacao: base.discriminacao,
        valores: {
          serviceAmountCents: base.servicosCents,
          deductionsCents: base.deducoesCents,
          discountCents: base.descontoCents,
          baseAmountCents: base.totais.baseCalculoCents,
          issRateBps: base.issRateBps,
          issAmountCents: base.totais.issCents,
          issRetained: base.issRetido,
          irrfCents: input.irrfCents ?? 0,
          pisCents: input.pisCents ?? 0,
          cofinsCents: input.cofinsCents ?? 0,
          csllCents: input.csllCents ?? 0,
          inssCents: input.inssCents ?? 0,
          totalCents: base.totais.totalCents,
        },
      };
      return { invoiceId: nota.id, pedido };
    });

    if (!pedido) return this.get(auth, invoiceId);

    // fora da transação: emissor real demora, e prender o banco esperando a
    // prefeitura é o jeito mais rápido de derrubar a oficina inteira
    let resposta;
    try {
      resposta = await this.deps.nfse.emitir(pedido);
    } catch (erro) {
      this.deps.log.error({ err: erro, invoiceId }, 'emissor de NFS-e falhou');
      await withTenant(this.deps.db, auth, async (tx) =>
        repo.updateInvoice(tx, invoiceId, {
          status: 'REJECTED',
          rejectionReason: 'O emissor não respondeu. A nota não foi emitida; tente de novo.',
          providerResponse: { erro: erro instanceof Error ? erro.message : String(erro) },
        }),
      );
      return this.get(auth, invoiceId);
    }

    await withTenant(this.deps.db, auth, async (tx) => {
      const nota = await repo.updateInvoice(tx, invoiceId, {
        status: resposta.status,
        environment: resposta.environment,
        provider: resposta.provider,
        providerRef: resposta.providerRef,
        invoiceNumber: resposta.invoiceNumber,
        verificationCode: resposta.verificationCode,
        publicUrl: resposta.publicUrl,
        pdfUrl: resposta.pdfUrl,
        xmlUrl: resposta.xmlUrl,
        issuedAt: resposta.issuedAt,
        rejectionReason: resposta.rejectionReason,
        providerResponse: resposta.raw,
      });
      if (resposta.status !== 'REJECTED') {
        await workOrderRepo.insertEvent(tx, {
          organizationId: auth.organizationId,
          workOrderId,
          type: 'INVOICE_ISSUED',
          data: {
            numero: nota.invoiceNumber,
            rps: `${nota.rpsSeries}-${nota.rpsNumber}`,
            valor: nota.totalCents,
            ambiente: nota.environment,
          },
          actorUserId: auth.userId,
        });
      }
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: resposta.status === 'REJECTED' ? 'invoice.rejected' : 'invoice.issued',
        entityType: 'invoice',
        entityId: invoiceId,
        workOrderId,
        ...client,
      });
    });

    return this.get(auth, invoiceId);
  }

  // ----------------------------- cancelamento -----------------------------

  async cancel(auth: AuthContext, invoiceId: string, input: CancelInvoiceInput, client: ClientInfo): Promise<Invoice> {
    const nota = await withTenant(this.deps.db, auth, async (tx) => {
      const travada = await repo.lockInvoice(tx, auth.organizationId, invoiceId);
      if (!travada) throw notFound('Nota não encontrada.');
      if (travada.status === 'CANCELED') {
        throw new AppError(409, ErrorCode.CONFLICT, 'Nota já cancelada', 'Esta nota já tinha sido cancelada.');
      }
      if (travada.status !== 'AUTHORIZED') {
        throw new AppError(
          422,
          ErrorCode.INVALID_TRANSITION,
          'Só nota autorizada pode ser cancelada',
          'Nota rejeitada ou ainda em processamento não tem o que cancelar na prefeitura.',
        );
      }
      return travada;
    });

    const resposta = await this.deps.nfse.cancelar({
      providerRef: nota.providerRef,
      invoiceId: nota.id,
      reason: input.reason,
    });

    await withTenant(this.deps.db, auth, async (tx) => {
      await repo.updateInvoice(tx, invoiceId, {
        status: 'CANCELED',
        canceledAt: resposta.canceledAt,
        cancelReason: input.reason,
        canceledBy: auth.userId,
        providerResponse: resposta.raw,
      });
      await workOrderRepo.insertEvent(tx, {
        organizationId: auth.organizationId,
        workOrderId: nota.workOrderId,
        type: 'INVOICE_CANCELED',
        data: { numero: nota.invoiceNumber, motivo: input.reason },
        actorUserId: auth.userId,
      });
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'invoice.canceled',
        entityType: 'invoice',
        entityId: invoiceId,
        workOrderId: nota.workOrderId,
        metadata: { reason: input.reason },
        ...client,
      });
    });

    return this.get(auth, invoiceId);
  }

  // ------------------------------- leitura --------------------------------

  async get(auth: AuthContext, id: string): Promise<Invoice> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const row = await repo.findInvoice(tx, auth.organizationId, id);
      if (!row) throw notFound('Nota não encontrada.');
      const itens = await repo.listItems(tx, auth.organizationId, id);
      return this.toDto(row, itens);
    });
  }

  async list(auth: AuthContext, query: InvoiceListQuery): Promise<Page<Invoice>> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const { rows, total } = await repo.listInvoices(tx, auth.organizationId, query);
      const data = rows.map((row) => this.toDto(row, []));
      return { data, meta: { page: query.page, pageSize: query.pageSize, total } };
    });
  }

  async byWorkOrder(auth: AuthContext, workOrderId: string): Promise<Invoice[]> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const { rows } = await repo.listInvoices(tx, auth.organizationId, { page: 1, pageSize: 50 });
      return rows.filter((row) => row.invoice.workOrderId === workOrderId).map((row) => this.toDto(row, []));
    });
  }

  // ------------------------------- interno --------------------------------

  /** Monta a nota a partir da OS: valores, texto e o que ainda falta. */
  private async montar(tx: Tx, organizationId: string, workOrderId: string, input?: IssueInvoiceInput) {
    const encontrada = await workOrderRepo.findWorkOrder(tx, organizationId, { id: workOrderId });
    if (!encontrada) throw notFound('OS não encontrada.');
    const { order, customer: resumo, vehicle } = encontrada;

    const [oficina, settings, cliente] = await Promise.all([
      orgRepo.findOrganization(tx, organizationId),
      this.readSettings(tx, organizationId),
      customerRepo.findCustomer(tx, organizationId, resumo.id),
    ]);
    if (!oficina) throw notFound('Oficina não encontrada.');
    if (!cliente) throw notFound('Cliente não encontrado.');
    const tomador = cliente.customer;

    const rows = await workOrderRepo.listItems(tx, organizationId, workOrderId);
    const lines: PricingLine[] = rows.map(({ item }) => ({
      type: item.type,
      quantityMilli: milli(item.quantity),
      unitPriceCents: item.unitPriceCents,
      discountCents: item.discountCents,
      isOptional: item.isOptional,
      approved: item.approvalStatus === 'APPROVED',
    }));
    const options = {
      discountMode: order.discountMode,
      discountValue: order.discountValue,
      surchargeCents: order.surchargeCents,
    };
    // mesma regra do `devidoCents`: houve aprovação, vale o aprovado; não
    // houve (serviço fechado no balcão), vale a OS inteira
    const sohAprovados = order.approvedTotalCents > 0;
    const totaisDaOs = sohAprovados ? computeApprovedTotals(lines, options) : computeTotals(lines, options);

    const servicos = rows
      .map((row, index) => ({ row, line: lines[index]! }))
      .filter(({ row, line }) => row.item.type === 'SERVICE' && (!sohAprovados || line.approved))
      .map(({ row, line }) => ({
        workOrderItemId: row.item.id,
        description: row.item.description,
        quantity: milliToNumber(milli(row.item.quantity)),
        unitPriceCents: row.item.unitPriceCents,
        totalCents: lineTotalCents(line),
      }));

    const servicosCents = totaisDaOs.servicesSubtotalCents;
    const descontoCents = descontoDosServicos(totaisDaOs.discountCents, servicosCents, totaisDaOs.subtotalCents);
    const deducoesCents = Math.max(0, input?.deductionsCents ?? 0);
    const issRateBps = settings.issRateBps ?? 0;
    const issRetido = input?.issRetained ?? settings.issRetainedDefault;
    const totais = totaisDaNota({
      servicosCents,
      deducoesCents,
      descontoCents,
      aliquotaIssBps: issRateBps,
      issRetido,
      irrfCents: input?.irrfCents,
      pisCents: input?.pisCents,
      cofinsCents: input?.cofinsCents,
      csllCents: input?.csllCents,
      inssCents: input?.inssCents,
    });

    const complemento = input?.additionalInformation ?? settings.additionalInformation;
    const discriminacao = [
      discriminacaoDosServicos(
        { plate: vehicle.plate, make: vehicle.make, model: vehicle.model },  // placa sempre existe; marca e modelo podem faltar
        servicos,
        order.number,
      ),
      complemento?.trim(),
    ]
      .filter(Boolean)
      .join('\n\n');

    const pendencias = pendenciasParaEmitir(
      {
        document: oficina.document,
        legalName: oficina.legalName,
        municipalRegistration: settings.municipalRegistration,
        taxRegime: settings.taxRegime,
        serviceListItem: settings.serviceListItem,
        issRateBps: settings.issRateBps,
        city: oficina.address?.city ?? null,
        state: oficina.address?.state ?? null,
      },
      {
        name: tomador.name,
        document: tomador.document,
        city: tomador.address?.city ?? null,
        state: tomador.address?.state ?? null,
        zip: tomador.address?.zip ?? null,
        street: tomador.address?.street ?? null,
        number: tomador.address?.number ?? null,
      },
      servicosCents,
    );

    return {
      order,
      vehicle,
      oficina,
      customer: tomador,
      settings,
      servicos,
      servicosCents,
      pecasCents: totaisDaOs.partsSubtotalCents,
      descontoCents,
      deducoesCents,
      issRateBps,
      issRetido,
      totais,
      discriminacao,
      pendencias,
    };
  }

  private toDto(row: repo.InvoiceJoinedRow, itens: repo.InvoiceItemRow[]): Invoice {
    const nota = row.invoice;
    return {
      id: nota.id,
      kind: nota.kind,
      status: nota.status,
      environment: nota.environment,
      provider: nota.provider,
      workOrderId: nota.workOrderId,
      workOrderNumber: row.workOrderNumber,
      customerId: nota.customerId,
      customerName: row.customerName,
      vehiclePlate: row.vehiclePlate,
      rpsNumber: nota.rpsNumber,
      rpsSeries: nota.rpsSeries,
      invoiceNumber: nota.invoiceNumber,
      verificationCode: nota.verificationCode,
      publicUrl: nota.publicUrl,
      pdfUrl: nota.pdfUrl,
      xmlUrl: nota.xmlUrl,
      serviceAmountCents: nota.serviceAmountCents,
      deductionsCents: nota.deductionsCents,
      discountCents: nota.discountCents,
      baseAmountCents: nota.baseAmountCents,
      issRateBps: nota.issRateBps,
      issAmountCents: nota.issAmountCents,
      issRetained: nota.issRetained,
      irrfCents: nota.irrfCents,
      pisCents: nota.pisCents,
      cofinsCents: nota.cofinsCents,
      csllCents: nota.csllCents,
      inssCents: nota.inssCents,
      totalCents: nota.totalCents,
      netCents: nota.netCents,
      description: nota.description,
      issuedAt: nota.issuedAt?.toISOString() ?? null,
      canceledAt: nota.canceledAt?.toISOString() ?? null,
      cancelReason: nota.cancelReason,
      rejectionReason: nota.rejectionReason,
      createdAt: nota.createdAt.toISOString(),
      items: itens.map((item) => ({
        id: item.id,
        description: item.description,
        quantity: milliToNumber(milli(item.quantity)),
        unitPriceCents: item.unitPriceCents,
        totalCents: item.totalCents,
        workOrderItemId: item.workOrderItemId,
      })),
    };
  }
}
