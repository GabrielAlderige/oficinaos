import { z } from 'zod';
import { WORK_ORDER_STATUSES } from './enums/work-orders';

/**
 * App do cliente (E50): o cliente da oficina abre um link no celular — sem
 * baixar nada da loja e sem senha — e vê os carros dele, o serviço em
 * andamento, o orçamento esperando resposta e tudo o que já foi feito. Dá
 * para pôr na tela inicial, como um aplicativo.
 *
 * O link é por CLIENTE e o token é a credencial (como o do orçamento): só o
 * hash fica no banco, e mandar de novo troca o link — o antigo para de
 * abrir. O que aparece é só o que é dele: custo, margem e observação interna
 * não passam por aqui.
 */

export const portalWorkOrderSchema = z.object({
  number: z.number().int(),
  status: z.enum(WORK_ORDER_STATUSES),
  statusLabel: z.string(),
  headline: z.string(),
  vehicleLabel: z.string(),
  openedAt: z.string(),
  promisedAt: z.string().nullable(),
  /** o acompanhamento detalhado (E17), quando a oficina já gerou o link */
  trackingUrl: z.string().nullable(),
});

export const portalQuoteSchema = z.object({
  number: z.number().int(),
  vehicleLabel: z.string(),
  totalCents: z.number().int(),
  validUntil: z.string(),
  url: z.string(),
});

export const portalHistorySchema = z.object({
  number: z.number().int(),
  vehicleLabel: z.string(),
  date: z.string(),
  totalCents: z.number().int(),
  services: z.array(z.string()),
});

export const publicPortalSchema = z.object({
  shopName: z.string(),
  shopWhatsapp: z.string().nullable(),
  shopAddress: z.string().nullable(),
  customerFirstName: z.string(),
  vehicles: z.array(z.object({ id: z.uuid(), label: z.string(), plate: z.string().nullable() })),
  current: z.array(portalWorkOrderSchema),
  quotes: z.array(portalQuoteSchema),
  history: z.array(portalHistorySchema),
});
export type PublicPortal = z.infer<typeof publicPortalSchema>;

/** A mensagem que leva o link: o cliente sabe de quem é e para que serve. */
export function whatsappPortalMessage(input: { customerName: string; shopName: string; url: string }): string {
  const nome = input.customerName.trim().split(/\s+/)[0] ?? input.customerName;
  return [
    `Olá, ${nome}! Aqui é da ${input.shopName}.`,
    'Este é o seu acesso à oficina: os seus carros, o serviço em andamento, os orçamentos e tudo o que já fizemos. Abre no navegador, sem baixar nada, e dá para pôr na tela inicial:',
    input.url,
  ].join('\n\n');
}
