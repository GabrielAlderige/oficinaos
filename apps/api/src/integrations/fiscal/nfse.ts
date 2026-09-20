import { createHash } from 'node:crypto';
import type { FiscalEnvironment } from '@oficinaos/shared';
import type { Env } from '../../config/env';

/**
 * Emissão de NFS-e atrás de uma interface (ARCHITECTURE §12), como o e-mail e
 * o storage. O domínio não sabe quem emite: ele monta o pedido, guarda a
 * resposta e mostra o resultado.
 *
 * Hoje existe um driver só, o **simulador**, e ele não emite nota nenhuma —
 * devolve `SIMULATOR` em `environment` para a tela marcar tudo como simulação.
 * Um driver real precisa apenas implementar `emitir` e `cancelar`; a conta, o
 * certificado e o token ficam do lado do emissor, nunca no nosso banco.
 */

export interface PedidoDeNfse {
  /** id da nota no nosso banco: serve de referência externa no emissor */
  invoiceId: string;
  rpsNumber: number;
  rpsSeries: string;
  prestador: {
    document: string;
    legalName: string;
    municipalRegistration: string;
    city: string;
    state: string;
    taxRegime: string;
    serviceListItem: string;
    municipalServiceCode: string | null;
    cnae: string | null;
    providerCompanyId: string | null;
  };
  tomador: {
    name: string;
    document: string | null;
    email: string | null;
    zip: string | null;
    street: string | null;
    number: string | null;
    complement: string | null;
    district: string | null;
    city: string | null;
    state: string | null;
  };
  servicos: {
    description: string;
    quantity: number;
    unitPriceCents: number;
    totalCents: number;
  }[];
  discriminacao: string;
  valores: {
    serviceAmountCents: number;
    deductionsCents: number;
    discountCents: number;
    baseAmountCents: number;
    issRateBps: number;
    issAmountCents: number;
    issRetained: boolean;
    irrfCents: number;
    pisCents: number;
    cofinsCents: number;
    csllCents: number;
    inssCents: number;
    totalCents: number;
  };
}

export interface RespostaDoEmissor {
  /** `AUTHORIZED` quando a prefeitura já autorizou; `QUEUED` quando ficou na fila */
  status: 'AUTHORIZED' | 'QUEUED' | 'REJECTED';
  environment: FiscalEnvironment;
  provider: string;
  providerRef: string | null;
  invoiceNumber: string | null;
  verificationCode: string | null;
  publicUrl: string | null;
  pdfUrl: string | null;
  xmlUrl: string | null;
  issuedAt: Date | null;
  rejectionReason: string | null;
  /** a resposta crua, guardada inteira: é ela que explica uma rejeição */
  raw: Record<string, unknown>;
}

export interface RespostaDeCancelamento {
  canceledAt: Date;
  provider: string;
  raw: Record<string, unknown>;
}

export interface NfseProvider {
  readonly driver: string;
  readonly environment: FiscalEnvironment;
  emitir(pedido: PedidoDeNfse): Promise<RespostaDoEmissor>;
  cancelar(input: { providerRef: string | null; invoiceId: string; reason: string }): Promise<RespostaDeCancelamento>;
}

/**
 * Simulador. Existe para a oficina percorrer o caminho inteiro — conferir os
 * dados, ver o ISS, emitir, cancelar — antes de contratar emissor. Ele:
 *
 * - **não** gera XML nem PDF (devolve `null`), porque documento fiscal
 *   falso é exatamente o tipo de coisa que não se inventa;
 * - devolve `environment: 'SIMULATOR'`, e a tela carimba "simulação" em tudo
 *   que vem daqui;
 * - numera de forma determinística (hash do id da nota), para o mesmo pedido
 *   devolver sempre o mesmo "número" e o teste não depender de sorte.
 */
export class SimuladorNfseProvider implements NfseProvider {
  readonly driver = 'simulador';
  readonly environment: FiscalEnvironment = 'SIMULATOR';

  async emitir(pedido: PedidoDeNfse): Promise<RespostaDoEmissor> {
    const digest = createHash('sha256').update(pedido.invoiceId).digest('hex');
    const numero = String(parseInt(digest.slice(0, 8), 16) % 1_000_000).padStart(6, '0');
    return {
      status: 'AUTHORIZED',
      environment: 'SIMULATOR',
      provider: this.driver,
      providerRef: `sim-${digest.slice(0, 12)}`,
      invoiceNumber: numero,
      verificationCode: digest.slice(12, 20).toUpperCase(),
      publicUrl: null,
      pdfUrl: null,
      xmlUrl: null,
      issuedAt: new Date(),
      rejectionReason: null,
      raw: {
        simulacao: true,
        aviso: 'Nota SIMULADA: nenhum documento fiscal foi emitido.',
        rps: `${pedido.rpsSeries}-${pedido.rpsNumber}`,
        totalCents: pedido.valores.totalCents,
      },
    };
  }

  async cancelar(input: { providerRef: string | null; invoiceId: string; reason: string }): Promise<RespostaDeCancelamento> {
    return {
      canceledAt: new Date(),
      provider: this.driver,
      raw: { simulacao: true, cancelada: input.providerRef ?? input.invoiceId, motivo: input.reason },
    };
  }
}

export function createNfseProvider(env: Env): NfseProvider {
  switch (env.FISCAL_DRIVER) {
    case 'simulador':
    default:
      return new SimuladorNfseProvider();
  }
}
