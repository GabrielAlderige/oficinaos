import { z } from 'zod';
import { DASHBOARD_PERIODS } from '../calendar';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida');

/**
 * A tela de comissões (E26): quanto cada mecânico ganhou no período, e de
 * onde veio cada real.
 *
 * O valor é sempre **o que o cliente já pagou**: a linha traz a OS, o que ela
 * deve, o que entrou e a comissão proporcional. Assim a conversa com o
 * mecânico acontece sobre o mesmo número que está na tela, e não sobre uma
 * conta feita à parte.
 */
export const commissionOrderSchema = z.object({
  workOrderId: z.uuid(),
  number: z.number().int(),
  customerName: z.string(),
  vehicleLabel: z.string(),
  deliveredAt: z.string().nullable(),
  /** total da OS */
  dueCents: z.number().int(),
  /** quanto o cliente já pagou */
  paidCents: z.number().int(),
  /** a comissão cheia, se a OS for quitada */
  fullCommissionCents: z.number().int(),
  /** o que já foi ganho, proporcional ao pago */
  earnedCents: z.number().int(),
});

export const commissionByMechanicSchema = z.object({
  mechanicUserId: z.uuid(),
  mechanicName: z.string(),
  /** soma da mão de obra das OS que aparecem aqui */
  laborCents: z.number().int(),
  fullCommissionCents: z.number().int(),
  earnedCents: z.number().int(),
  /** já pago em fechamentos deste período */
  paidOutCents: z.number().int(),
  orders: z.array(commissionOrderSchema),
});

export const commissionReportSchema = z.object({
  from: isoDate,
  to: isoDate,
  /** a oficina não paga comissão nenhuma: a tela explica em vez de mostrar zero */
  configured: z.boolean(),
  mechanics: z.array(commissionByMechanicSchema),
  totals: z.object({
    fullCommissionCents: z.number().int(),
    earnedCents: z.number().int(),
    paidOutCents: z.number().int(),
  }),
});

export const commissionQuerySchema = z.object({
  /**
   * Atalho (hoje, semana, mês, últimos 7/30), resolvido no fuso da oficina,
   * igual ao financeiro. Datas explícitas mandam sobre ele.
   */
  period: z.enum(DASHBOARD_PERIODS).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  mechanicId: z.uuid().optional(),
});

/** O fechamento: "paguei R$ 1.240 de comissão ao Zé, referente a setembro". */
export const commissionPayoutSchema = z.object({
  id: z.uuid(),
  mechanicUserId: z.uuid(),
  mechanicName: z.string(),
  periodFrom: isoDate,
  periodTo: isoDate,
  amountCents: z.number().int(),
  notes: z.string().nullable(),
  paidAt: z.string(),
  createdByName: z.string().nullable(),
});

export const createCommissionPayoutSchema = z.object({
  mechanicUserId: z.uuid(),
  periodFrom: isoDate,
  periodTo: isoDate,
  amountCents: z.number().int().min(1, 'O valor precisa ser maior que zero').max(100_000_000),
  notes: z.string().trim().max(300).optional(),
});

export type CommissionOrder = z.infer<typeof commissionOrderSchema>;
export type CommissionByMechanic = z.infer<typeof commissionByMechanicSchema>;
export type CommissionReport = z.infer<typeof commissionReportSchema>;
export type CommissionQuery = z.output<typeof commissionQuerySchema>;
export type CommissionPayout = z.infer<typeof commissionPayoutSchema>;
export type CreateCommissionPayoutInput = z.output<typeof createCommissionPayoutSchema>;
