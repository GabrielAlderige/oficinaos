import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  cancelWorkOrderSchema,
  createInspectionSchema,
  createWorkOrderSchema,
  idParamSchema,
  inspectionSchema,
  paginated,
  reorderItemsSchema,
  updateWorkOrderItemSchema,
  updateWorkOrderSchema,
  workOrderBoardSchema,
  workOrderEventSchema,
  workOrderItemInputSchema,
  workOrderListItemSchema,
  workOrderListQuerySchema,
  workOrderNoteSchema,
  workOrderSchema,
  WORK_ORDER_TRANSITIONS,
  type WorkOrderAction,
} from '@oficinaos/shared';
import { clientInfo, getAuth } from '../../core/auth-context';

const numberParam = z.object({ number: z.coerce.number().int().min(1).max(99_999_999) });
const itemParams = z.object({ id: z.uuid(), itemId: z.uuid() });

/**
 * Transições são AÇÕES explícitas (`POST /work-orders/{id}/start`), nunca um
 * `PATCH status`: cada uma tem a própria permissão, tirada da máquina de
 * estados, e a própria entrada na auditoria (docs/API.md §1).
 */
const STATUS_ACTIONS: { path: string; action: WorkOrderAction }[] = [
  { path: '/:id/start-diagnosis', action: 'start-diagnosis' },
  { path: '/:id/finish-diagnosis', action: 'finish-diagnosis' },
  { path: '/:id/start', action: 'start' },
  { path: '/:id/wait-parts', action: 'wait-parts' },
  { path: '/:id/complete', action: 'complete' },
  { path: '/:id/deliver', action: 'deliver' },
  { path: '/:id/reopen', action: 'reopen' },
];

export const workOrderRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = app.services.workOrders;

  app.get(
    '/',
    {
      config: { auth: 'work_orders:read' },
      schema: { querystring: workOrderListQuerySchema, response: { 200: paginated(workOrderListItemSchema) } },
    },
    async (request) => service.list(getAuth(request), request.query),
  );

  app.get(
    '/board',
    { config: { auth: 'work_orders:read' }, schema: { response: { 200: workOrderBoardSchema } } },
    async (request) => service.board(getAuth(request)),
  );

  app.post(
    '/',
    { config: { auth: 'work_orders:write' }, schema: { body: createWorkOrderSchema, response: { 201: workOrderSchema } } },
    async (request, reply) => {
      reply.code(201);
      return service.create(getAuth(request), request.body, clientInfo(request));
    },
  );

  // a URL usa o NÚMERO da OS, que é o que a equipe fala e digita (ARCHITECTURE §13.1)
  app.get(
    '/:number',
    { config: { auth: 'work_orders:read' }, schema: { params: numberParam, response: { 200: workOrderSchema } } },
    async (request) => service.getByNumber(getAuth(request), request.params.number),
  );

  app.patch(
    '/:id',
    {
      config: { auth: 'work_orders:write' },
      schema: { params: idParamSchema, body: updateWorkOrderSchema, response: { 200: workOrderSchema } },
    },
    async (request) => service.update(getAuth(request), request.params.id, request.body, clientInfo(request)),
  );

  // ------------------------------------------------------------- itens

  app.post(
    '/:id/items',
    {
      config: { auth: 'work_orders:write' },
      schema: { params: idParamSchema, body: workOrderItemInputSchema, response: { 201: workOrderSchema } },
    },
    async (request, reply) => {
      reply.code(201);
      return service.addItem(getAuth(request), request.params.id, request.body, clientInfo(request));
    },
  );

  app.patch(
    '/:id/items/:itemId',
    {
      config: { auth: 'work_orders:write' },
      schema: { params: itemParams, body: updateWorkOrderItemSchema, response: { 200: workOrderSchema } },
    },
    async (request) =>
      service.updateItem(
        getAuth(request),
        request.params.id,
        request.params.itemId,
        request.body,
        clientInfo(request),
      ),
  );

  app.delete(
    '/:id/items/:itemId',
    { config: { auth: 'work_orders:write' }, schema: { params: itemParams, response: { 200: workOrderSchema } } },
    async (request) => service.removeItem(getAuth(request), request.params.id, request.params.itemId, clientInfo(request)),
  );

  app.put(
    '/:id/items/order',
    {
      config: { auth: 'work_orders:write' },
      schema: { params: idParamSchema, body: reorderItemsSchema, response: { 200: workOrderSchema } },
    },
    async (request) =>
      service.reorderItems(getAuth(request), request.params.id, request.body.itemIds, clientInfo(request)),
  );

  // -------------------------------------------------- timeline e check-in

  app.get(
    '/:id/timeline',
    {
      config: { auth: 'work_orders:read' },
      schema: { params: idParamSchema, response: { 200: z.object({ data: z.array(workOrderEventSchema) }) } },
    },
    async (request) => ({ data: await service.timeline(getAuth(request), request.params.id) }),
  );

  /** Devolve a mensagem pronta e o link wa.me: quem envia é a pessoa (V1). */
  app.post(
    '/:id/vehicle-ready',
    {
      config: { auth: 'work_orders:write' },
      schema: {
        params: idParamSchema,
        response: { 200: z.object({ message: z.string(), whatsappUrl: z.string().nullable() }) },
      },
    },
    async (request) => service.vehicleReady(getAuth(request), request.params.id, clientInfo(request)),
  );

  /**
   * Cronômetro do item de serviço (E15). É `work_orders:change_status` de
   * propósito: quem executa é quem cronometra, e o mecânico tem essa permissão.
   */
  app.post(
    '/:id/items/:itemId/timer/start',
    {
      config: { auth: 'work_orders:change_status' },
      schema: { params: itemParams, response: { 200: workOrderSchema } },
    },
    async (request) =>
      service.startItemTimer(getAuth(request), request.params.id, request.params.itemId, clientInfo(request)),
  );

  app.post(
    '/:id/items/:itemId/timer/stop',
    {
      config: { auth: 'work_orders:change_status' },
      schema: { params: itemParams, response: { 200: workOrderSchema } },
    },
    async (request) =>
      service.stopItemTimer(getAuth(request), request.params.id, request.params.itemId, clientInfo(request)),
  );

  app.post(
    '/:id/notes',
    {
      config: { auth: 'work_orders:write' },
      schema: { params: idParamSchema, body: workOrderNoteSchema, response: { 201: workOrderEventSchema } },
    },
    async (request, reply) => {
      reply.code(201);
      return service.addNote(getAuth(request), request.params.id, request.body.text, clientInfo(request));
    },
  );

  app.get(
    '/:id/inspections',
    {
      config: { auth: 'work_orders:read' },
      schema: { params: idParamSchema, response: { 200: z.object({ data: z.array(inspectionSchema) }) } },
    },
    async (request) => ({ data: await service.inspections(getAuth(request), request.params.id) }),
  );

  app.post(
    '/:id/inspections',
    {
      config: { auth: 'work_orders:write' },
      schema: { params: idParamSchema, body: createInspectionSchema, response: { 201: inspectionSchema } },
    },
    async (request, reply) => {
      reply.code(201);
      return service.createInspection(getAuth(request), request.params.id, request.body, clientInfo(request));
    },
  );

  // ---------------------------------------------------- ações de status

  for (const { path, action } of STATUS_ACTIONS) {
    app.post(
      path,
      {
        config: { auth: WORK_ORDER_TRANSITIONS[action].permission },
        schema: { params: idParamSchema, response: { 200: workOrderSchema } },
      },
      async (request) => service.runAction(getAuth(request), request.params.id, action, {}, clientInfo(request)),
    );
  }

  // cancelar é a única ação com motivo obrigatório
  app.post(
    '/:id/cancel',
    {
      config: { auth: WORK_ORDER_TRANSITIONS.cancel.permission },
      schema: { params: idParamSchema, body: cancelWorkOrderSchema, response: { 200: workOrderSchema } },
    },
    async (request) =>
      service.runAction(getAuth(request), request.params.id, 'cancel', { reason: request.body.reason }, clientInfo(request)),
  );
};
