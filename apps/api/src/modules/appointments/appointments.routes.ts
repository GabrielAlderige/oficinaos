import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  appointmentCheckInSchema,
  appointmentListQuerySchema,
  appointmentListSchema,
  appointmentSchema,
  APPOINTMENT_TRANSITIONS,
  cancelAppointmentSchema,
  conflictListSchema,
  conflictQuerySchema,
  createAppointmentSchema,
  idParamSchema,
  rescheduleAppointmentSchema,
  workOrderSchema,
  type AppointmentAction,
} from '@oficinaos/shared';
import { clientInfo, getAuth } from '../../core/auth-context';

/** Como na OS: transição é AÇÃO explícita, com permissão tirada da máquina de estados. */
const STATUS_ACTIONS: { path: string; action: Exclude<AppointmentAction, 'check-in' | 'cancel'> }[] = [
  { path: '/:id/confirm', action: 'confirm' },
  { path: '/:id/complete', action: 'complete' },
  { path: '/:id/no-show', action: 'no-show' },
];

export const appointmentRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = app.services.appointments;

  app.get(
    '/',
    {
      config: { auth: 'appointments:read' },
      schema: { querystring: appointmentListQuerySchema, response: { 200: appointmentListSchema } },
    },
    async (request) => service.list(getAuth(request), request.query),
  );

  /** Conferência enquanto a pessoa preenche, antes de tentar gravar. */
  app.get(
    '/conflicts',
    {
      config: { auth: 'appointments:read' },
      schema: { querystring: conflictQuerySchema, response: { 200: conflictListSchema } },
    },
    async (request) => service.conflicts(getAuth(request), request.query),
  );

  app.get(
    '/:id',
    {
      config: { auth: 'appointments:read' },
      schema: { params: idParamSchema, response: { 200: appointmentSchema } },
    },
    async (request) => service.get(getAuth(request), request.params.id),
  );

  app.post(
    '/',
    {
      config: { auth: 'appointments:write' },
      schema: { body: createAppointmentSchema, response: { 201: appointmentSchema } },
    },
    async (request, reply) => {
      reply.code(201);
      return service.create(getAuth(request), request.body, clientInfo(request));
    },
  );

  /** Remarcar, inclusive por arrastar e soltar. */
  app.patch(
    '/:id',
    {
      config: { auth: 'appointments:write' },
      schema: { params: idParamSchema, body: rescheduleAppointmentSchema, response: { 200: appointmentSchema } },
    },
    async (request) =>
      service.reschedule(getAuth(request), request.params.id, request.body, clientInfo(request)),
  );

  for (const { path, action } of STATUS_ACTIONS) {
    app.post(
      path,
      {
        config: { auth: APPOINTMENT_TRANSITIONS[action].permission },
        schema: { params: idParamSchema, response: { 200: appointmentSchema } },
      },
      async (request) => service.transition(getAuth(request), request.params.id, action, clientInfo(request)),
    );
  }

  /** Cancelar exige motivo: some da agenda, mas não da história. */
  app.post(
    '/:id/cancel',
    {
      config: { auth: APPOINTMENT_TRANSITIONS.cancel.permission },
      schema: { params: idParamSchema, body: cancelAppointmentSchema, response: { 200: appointmentSchema } },
    },
    async (request) =>
      service.transition(getAuth(request), request.params.id, 'cancel', clientInfo(request), request.body),
  );

  /** Devolve a mensagem pronta e o link wa.me: quem envia é a pessoa (V1). */
  app.post(
    '/:id/confirmation',
    {
      config: { auth: 'appointments:write' },
      schema: {
        params: idParamSchema,
        response: { 200: z.object({ message: z.string(), whatsappUrl: z.string().nullable() }) },
      },
    },
    async (request) => service.confirmationMessage(getAuth(request), request.params.id, clientInfo(request)),
  );

  /**
   * O carro chegou: cria a OS e devolve ela inteira, porque a tela vai direto
   * para a ficha da OS fazer a vistoria com fotos.
   */
  app.post(
    '/:id/check-in',
    {
      config: { auth: APPOINTMENT_TRANSITIONS['check-in'].permission },
      schema: { params: idParamSchema, body: appointmentCheckInSchema, response: { 201: workOrderSchema } },
    },
    async (request, reply) => {
      reply.code(201);
      return service.checkIn(getAuth(request), request.params.id, request.body, clientInfo(request));
    },
  );
};
