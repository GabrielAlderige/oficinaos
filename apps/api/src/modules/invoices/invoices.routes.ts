import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  cancelInvoiceSchema,
  fiscalSettingsSchema,
  idParamSchema,
  invoiceListQuerySchema,
  invoicePreviewSchema,
  invoiceSchema,
  issueInvoiceSchema,
  paginated,
  updateFiscalSettingsSchema,
} from '@oficinaos/shared';
import { clientInfo, getAuth } from '../../core/auth-context';

/**
 * Nota fiscal de serviço (E18).
 *
 * Emitir é `invoices:issue` e cancelar é `invoices:cancel` — separadas de
 * propósito: o atendente que entrega o carro emite a nota, mas cancelar nota
 * autorizada tem prazo curto na prefeitura e consequência com o contador, e
 * isso fica com gerente, financeiro e dono.
 */
export const invoiceRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = app.services.invoices;

  app.get(
    '/',
    {
      config: { auth: 'invoices:read' },
      schema: { querystring: invoiceListQuerySchema, response: { 200: paginated(invoiceSchema) } },
    },
    async (request) => service.list(getAuth(request), request.query),
  );

  app.get(
    '/:id',
    {
      config: { auth: 'invoices:read' },
      schema: { params: idParamSchema, response: { 200: invoiceSchema } },
    },
    async (request) => service.get(getAuth(request), request.params.id),
  );

  app.post(
    '/:id/cancel',
    {
      config: { auth: 'invoices:cancel' },
      schema: { params: idParamSchema, body: cancelInvoiceSchema, response: { 200: invoiceSchema } },
    },
    async (request) => service.cancel(getAuth(request), request.params.id, request.body, clientInfo(request)),
  );
};

/** Configuração fiscal da oficina: quem mexe é quem mexe na oficina. */
export const fiscalSettingsRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = app.services.invoices;

  app.get(
    '/',
    { config: { auth: 'invoices:read' }, schema: { response: { 200: fiscalSettingsSchema } } },
    async (request) => service.settings(getAuth(request)),
  );

  app.put(
    '/',
    {
      config: { auth: 'organization:manage' },
      schema: { body: updateFiscalSettingsSchema, response: { 200: fiscalSettingsSchema } },
    },
    async (request) => service.updateSettings(getAuth(request), request.body, clientInfo(request)),
  );
};

/** A nota nasce da OS: é lá que a oficina aperta o botão. */
export const workOrderInvoiceRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = app.services.invoices;

  app.get(
    '/:id/invoices',
    {
      config: { auth: 'invoices:read' },
      schema: { params: idParamSchema, response: { 200: z.object({ data: z.array(invoiceSchema) }) } },
    },
    async (request) => ({ data: await service.byWorkOrder(getAuth(request), request.params.id) }),
  );

  app.get(
    '/:id/invoices/preview',
    {
      config: { auth: 'invoices:read' },
      schema: { params: idParamSchema, response: { 200: invoicePreviewSchema } },
    },
    async (request) => service.preview(getAuth(request), request.params.id),
  );

  app.post(
    '/:id/invoices',
    {
      config: { auth: 'invoices:issue' },
      schema: { params: idParamSchema, body: issueInvoiceSchema, response: { 201: invoiceSchema } },
    },
    async (request, reply) => {
      const nota = await service.issue(getAuth(request), request.params.id, request.body, clientInfo(request));
      return reply.code(201).send(nota);
    },
  );
};
