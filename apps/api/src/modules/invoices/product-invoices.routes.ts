import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  cancelProductInvoiceSchema,
  idParamSchema,
  issueProductInvoiceSchema,
  PRODUCT_INVOICE_MODELS,
  productInvoicePreviewSchema,
  productInvoiceSchema,
} from '@oficinaos/shared';
import { clientInfo, getAuth } from '../../core/auth-context';

const origemSchema = z
  .object({
    counterSaleId: z.uuid().optional(),
    workOrderId: z.uuid().optional(),
    model: z.enum(PRODUCT_INVOICE_MODELS).default('NFCE'),
  })
  .refine((v) => !!v.counterSaleId !== !!v.workOrderId, { message: 'Informe a venda de balcão ou a OS', path: ['counterSaleId'] });

const origem = (q: { counterSaleId?: string; workOrderId?: string }) => ({
  counterSaleId: q.counterSaleId ?? null,
  workOrderId: q.workOrderId ?? null,
});

/**
 * Nota fiscal de peças (E50): NFC-e no balcão, NF-e para empresa. As mesmas
 * permissões da nota de serviço — quem emite uma emite a outra.
 */
export const productInvoiceRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = app.services.productInvoices;

  app.get(
    '/',
    {
      config: { auth: 'invoices:read' },
      schema: { querystring: origemSchema, response: { 200: z.object({ data: z.array(productInvoiceSchema) }) } },
    },
    async (request) => ({ data: await service.listFor(getAuth(request), origem(request.query)) }),
  );

  app.get(
    '/preview',
    {
      config: { auth: 'invoices:read' },
      schema: { querystring: origemSchema, response: { 200: productInvoicePreviewSchema } },
    },
    async (request) => service.preview(getAuth(request), origem(request.query), request.query.model),
  );

  app.post(
    '/',
    {
      config: { auth: 'invoices:issue', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: { body: issueProductInvoiceSchema, response: { 201: productInvoiceSchema } },
    },
    async (request, reply) => reply.code(201).send(await service.issue(getAuth(request), request.body, clientInfo(request))),
  );

  app.get(
    '/:id',
    { config: { auth: 'invoices:read' }, schema: { params: idParamSchema, response: { 200: productInvoiceSchema } } },
    async (request) => service.get(getAuth(request), request.params.id),
  );

  app.post(
    '/:id/cancel',
    {
      config: { auth: 'invoices:cancel' },
      schema: { params: idParamSchema, body: cancelProductInvoiceSchema, response: { 200: productInvoiceSchema } },
    },
    async (request) => service.cancel(getAuth(request), request.params.id, request.body.reason, clientInfo(request)),
  );
};
