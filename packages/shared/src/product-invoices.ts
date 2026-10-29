import { z } from 'zod';
import { FISCAL_ENVIRONMENTS, INVOICE_STATUSES, type TaxRegime } from './enums/fiscal';
import type { PaymentMethod } from './enums/payments';

/**
 * Nota fiscal de PEÇAS (E50): a nota estadual da mercadoria, que a NFS-e (E18)
 * não cobre. Duas formas:
 *
 * - **NFC-e** (modelo 65), a nota do consumidor: o cliente leva a peça no
 *   balcão ou no carro. Autoriza na hora, com QR Code.
 * - **NF-e** (modelo 55), a nota "grande": quando o cliente é empresa e quer
 *   a nota no CNPJ, com endereço. A SEFAZ autoriza depois, em fila.
 *
 * O que vai na nota é só PEÇA do catálogo, com NCM: serviço é NFS-e, item
 * avulso sem cadastro não tem como ser tributado, e peça que o cliente trouxe
 * não foi vendida pela oficina.
 */

export const PRODUCT_INVOICE_MODELS = ['NFCE', 'NFE'] as const;
export type ProductInvoiceModel = (typeof PRODUCT_INVOICE_MODELS)[number];
export const PRODUCT_INVOICE_MODEL_LABELS: Record<ProductInvoiceModel, string> = {
  NFCE: 'NFC-e (nota do consumidor)',
  NFE: 'NF-e (nota para empresa)',
};

/** Venda de mercadoria adquirida de terceiros, dentro do estado: o caso da oficina. */
export const CFOP_PADRAO = '5102';
/** Fora do estado (NF-e para cliente de outra UF). */
export const CFOP_INTERESTADUAL = '6102';

/**
 * A situação do ICMS que vai em cada item. No Simples (e no MEI) é o CSOSN
 * 102 — "tributada pelo Simples sem permissão de crédito" —, o caso de quase
 * toda oficina. Fora do Simples a nota precisa de alíquota e base de cálculo
 * definidas pelo contador: aí a oficina informa a situação, ou a nota não sai.
 */
export function icmsSituacaoDaNota(regime: TaxRegime | null, informada: string | null): string | null {
  if (informada?.trim()) return informada.trim();
  if (regime === 'SIMPLES_NACIONAL' || regime === 'MEI') return '102';
  return null;
}

/**
 * Código da forma de pagamento da nota (tabela da SEFAZ): 01 dinheiro, 03
 * crédito, 04 débito, 05 crédito loja (o fiado), 15 boleto, 17 Pix, 18
 * transferência, 99 outros.
 */
export function formaDePagamentoDaNota(metodo: PaymentMethod | 'LATER' | null): string {
  switch (metodo) {
    case 'CASH':
      return '01';
    case 'CREDIT_CARD':
      return '03';
    case 'DEBIT_CARD':
      return '04';
    case 'LATER':
      return '05';
    case 'BOLETO':
      return '15';
    case 'PIX':
      return '17';
    case 'BANK_TRANSFER':
      return '18';
    default:
      return '99';
  }
}

/**
 * O desconto geral espalhado pelas linhas, na proporção de cada uma, sem
 * perder centavo: o que sobra do arredondamento vai para as maiores. A soma
 * dos descontos das linhas é sempre exatamente o desconto.
 */
export function ratearDesconto(brutos: number[], desconto: number): number[] {
  const total = brutos.reduce((s, v) => s + v, 0);
  if (desconto <= 0 || total <= 0) return brutos.map(() => 0);
  const alvo = Math.min(desconto, total);
  const partes = brutos.map((bruto) => Math.floor((bruto * alvo) / total));
  let resto = alvo - partes.reduce((s, v) => s + v, 0);
  const ordem = brutos.map((bruto, i) => ({ bruto, i })).sort((a, b) => b.bruto - a.bruto);
  for (let k = 0; resto > 0; k = (k + 1) % ordem.length) {
    const i = ordem[k]!.i;
    if (partes[i]! < brutos[i]!) {
      partes[i]! += 1;
      resto -= 1;
    }
  }
  return partes;
}

export interface PendenciaDaNotaDePecas {
  campo: string;
  mensagem: string;
}

/**
 * O que falta para a nota sair — dito em português, com o lugar onde
 * resolver. A nota não é enviada com pendência: a SEFAZ recusaria, e nota
 * recusada assusta mais do que um aviso antes.
 */
export function pendenciasDaNotaDePecas(entrada: {
  modelo: ProductInvoiceModel;
  cnpjOficina: string | null;
  inscricaoEstadual: string | null;
  icmsSituacao: string | null;
  itens: { nome: string; ncm: string | null }[];
  cliente: {
    documento: string | null;
    endereco: { street?: string; number?: string; district?: string; city?: string; state?: string; zip?: string } | null;
  } | null;
}): PendenciaDaNotaDePecas[] {
  const pendencias: PendenciaDaNotaDePecas[] = [];
  if ((entrada.cnpjOficina ?? '').replace(/\D/g, '').length !== 14) {
    pendencias.push({ campo: 'cnpj', mensagem: 'Cadastre o CNPJ da oficina em Configurações → Oficina.' });
  }
  if (!entrada.inscricaoEstadual?.trim()) {
    pendencias.push({ campo: 'ie', mensagem: 'Cadastre a inscrição estadual em Configurações → Fiscal (a nota de peça é estadual).' });
  }
  if (!entrada.icmsSituacao) {
    pendencias.push({
      campo: 'icms',
      mensagem: 'Fora do Simples Nacional, informe com o seu contador a situação do ICMS das peças em Configurações → Fiscal.',
    });
  }
  if (!entrada.itens.length) {
    pendencias.push({ campo: 'itens', mensagem: 'Não há peça do catálogo para pôr na nota (serviço vai na nota de serviço).' });
  }
  for (const item of entrada.itens) {
    if (!/^\d{8}$/.test((item.ncm ?? '').replace(/\D/g, ''))) {
      pendencias.push({ campo: 'ncm', mensagem: `A peça "${item.nome}" está sem NCM (8 dígitos). Cadastre na ficha da peça.` });
    }
  }
  if (entrada.modelo === 'NFE') {
    const doc = (entrada.cliente?.documento ?? '').replace(/\D/g, '');
    if (doc.length !== 11 && doc.length !== 14) {
      pendencias.push({ campo: 'cliente', mensagem: 'A NF-e precisa do cliente com CPF ou CNPJ.' });
    }
    const e = entrada.cliente?.endereco;
    if (!e?.street || !e.number || !e.district || !e.city || !e.state || !e.zip) {
      pendencias.push({ campo: 'endereco', mensagem: 'A NF-e precisa do endereço completo do cliente (rua, número, bairro, cidade, UF e CEP).' });
    }
  }
  return pendencias;
}

// ------------------------------------------------------------------ contrato da API

export const issueProductInvoiceSchema = z
  .object({
    clientRequestId: z.uuid(),
    model: z.enum(PRODUCT_INVOICE_MODELS).default('NFCE'),
    counterSaleId: z.uuid().nullable().default(null),
    workOrderId: z.uuid().nullable().default(null),
  })
  .refine((v) => (v.counterSaleId === null) !== (v.workOrderId === null), {
    message: 'A nota é de uma venda de balcão ou de uma OS',
    path: ['counterSaleId'],
  });
export type IssueProductInvoiceInput = z.input<typeof issueProductInvoiceSchema>;

export const cancelProductInvoiceSchema = z.object({
  reason: z.string().trim().min(15, 'A SEFAZ pede pelo menos 15 caracteres de motivo').max(255),
});

export const productInvoiceItemSchema = z.object({
  description: z.string(),
  ncm: z.string(),
  cfop: z.string(),
  quantity: z.number(),
  unitPriceCents: z.number().int(),
  discountCents: z.number().int(),
  totalCents: z.number().int(),
});

export const productInvoiceSchema = z.object({
  id: z.uuid(),
  model: z.enum(PRODUCT_INVOICE_MODELS),
  status: z.enum(INVOICE_STATUSES),
  environment: z.enum(FISCAL_ENVIRONMENTS),
  counterSaleId: z.uuid().nullable(),
  workOrderId: z.uuid().nullable(),
  customerName: z.string().nullable(),
  number: z.string().nullable(),
  series: z.string().nullable(),
  accessKey: z.string().nullable(),
  danfeUrl: z.string().nullable(),
  xmlUrl: z.string().nullable(),
  qrcodeUrl: z.string().nullable(),
  totalCents: z.number().int(),
  rejectionReason: z.string().nullable(),
  issuedAt: z.string().nullable(),
  canceledAt: z.string().nullable(),
  cancelReason: z.string().nullable(),
  createdAt: z.string(),
  items: z.array(productInvoiceItemSchema),
});
export type ProductInvoice = z.infer<typeof productInvoiceSchema>;

export const productInvoicePreviewSchema = z.object({
  model: z.enum(PRODUCT_INVOICE_MODELS),
  environment: z.enum(FISCAL_ENVIRONMENTS),
  items: z.array(productInvoiceItemSchema),
  totalCents: z.number().int(),
  /** itens da venda/OS que NÃO vão na nota, e por quê */
  leftOut: z.array(z.object({ description: z.string(), reason: z.string() })),
  issues: z.array(z.object({ campo: z.string(), mensagem: z.string() })),
});
export type ProductInvoicePreview = z.infer<typeof productInvoicePreviewSchema>;
