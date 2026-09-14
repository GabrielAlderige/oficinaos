import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  awardSupplierQuoteSchema,
  cancelSupplierQuoteSchema,
  createdSupplierQuoteSchema,
  createSupplierQuoteSchema,
  idParamSchema,
  issuedSupplierLinkSchema,
  supplierQuoteListItemSchema,
  supplierQuoteSchema,
} from '@oficinaos/shared';
import { clientInfo, getAuth } from '../../core/auth-context';

const inviteParams = z.object({ id: z.uuid(), inviteId: z.uuid() });

/**
 * Cotação com fornecedores — o lado da oficina (MVP 2, E11). Três permissões
 * diferentes, de propósito: ler (`suppliers:read`), pedir (`supplier_quotes:send`)
 * e escolher (`supplier_quotes:award`). VER o preço é `parts:view_cost`, e isso
 * o serviço resolve na resposta — a rota é a mesma para todos.
 */
export const supplierQuoteRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = app.services.supplierQuotes;

  app.post(
    '/',
    {
      config: { auth: 'supplier_quotes:send' },
      schema: { body: createSupplierQuoteSchema, response: { 201: createdSupplierQuoteSchema } },
    },
    async (request, reply) => {
      reply.code(201);
      return service.create(getAuth(request), request.body, clientInfo(request));
    },
  );

  app.get(
    '/:id',
    {
      config: { auth: 'suppliers:read' },
      schema: { params: idParamSchema, response: { 200: supplierQuoteSchema } },
    },
    async (request) => service.get(getAuth(request), request.params.id),
  );

  /** O link morre e nasce outro: é assim que se corrige "mandei para o número errado". */
  app.post(
    '/:id/invites/:inviteId/reissue',
    {
      config: { auth: 'supplier_quotes:send' },
      schema: { params: inviteParams, response: { 200: issuedSupplierLinkSchema } },
    },
    async (request) =>
      service.reissueLink(getAuth(request), request.params.id, request.params.inviteId, clientInfo(request)),
  );

  app.post(
    '/:id/cancel',
    {
      config: { auth: 'supplier_quotes:send' },
      schema: { params: idParamSchema, body: cancelSupplierQuoteSchema, response: { 200: supplierQuoteSchema } },
    },
    async (request) => service.cancel(getAuth(request), request.params.id, request.body, clientInfo(request)),
  );

  app.post(
    '/:id/award',
    {
      config: { auth: 'supplier_quotes:award' },
      schema: { params: idParamSchema, body: awardSupplierQuoteSchema, response: { 200: supplierQuoteSchema } },
    },
    async (request) => service.award(getAuth(request), request.params.id, request.body, clientInfo(request)),
  );
};

/** As cotações de uma OS, na ficha dela. */
export const workOrderSupplierQuoteRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = app.services.supplierQuotes;

  app.get(
    '/:id/supplier-quotes',
    {
      config: { auth: 'suppliers:read' },
      schema: { params: idParamSchema, response: { 200: z.object({ data: z.array(supplierQuoteListItemSchema) }) } },
    },
    async (request) => service.listForWorkOrder(getAuth(request), request.params.id),
  );
};
