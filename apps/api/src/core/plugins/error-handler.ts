import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { ErrorCode, type Problem } from '@oficinaos/shared';
import { AppError, type FieldError } from '../errors';

const PROBLEM_TYPE = 'urn:oficinaos:error:';

function send(reply: FastifyReply, request: FastifyRequest, problem: Omit<Problem, 'type' | 'requestId'>) {
  const body: Problem = {
    type: PROBLEM_TYPE + problem.code.toLowerCase().replaceAll('_', '-'),
    ...problem,
    requestId: String(request.id),
  };
  return reply.status(problem.status).type('application/problem+json').send(body);
}

/** "/items/2/quantity" em "body" → "body.items.2.quantity" */
function toPath(context: string | undefined, instancePath: string): string {
  const parts = instancePath.split('/').filter(Boolean);
  return [context, ...parts].filter(Boolean).join('.');
}

/** Toda resposta de erro sai como RFC 9457 (application/problem+json). */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | AppError, request, reply) => {
    if (error instanceof AppError) {
      return send(reply, request, {
        status: error.status,
        code: error.code,
        title: error.title,
        detail: error.detail,
        errors: error.errors,
      });
    }

    if (hasZodFastifySchemaValidationErrors(error)) {
      const errors: FieldError[] = error.validation.map((issue) => ({
        path: toPath(error.validationContext, issue.instancePath),
        message: issue.message ?? 'Valor inválido',
      }));
      return send(reply, request, {
        status: 400,
        code: ErrorCode.VALIDATION_FAILED,
        title: 'Dados inválidos',
        detail: 'Confira os campos destacados.',
        errors,
      });
    }

    const status = error.statusCode ?? 500;

    if (status === 429) {
      return send(reply, request, {
        status,
        code: ErrorCode.RATE_LIMITED,
        title: 'Muitas requisições',
        detail: 'Aguarde um instante e tente de novo.',
      });
    }

    // Erros do próprio Fastify com status 4xx (JSON malformado, corpo grande demais…)
    if (status >= 400 && status < 500) {
      return send(reply, request, {
        status,
        code: ErrorCode.BAD_REQUEST,
        title: 'Requisição inválida',
        detail: error.message,
      });
    }

    request.log.error({ err: error }, 'erro não tratado');
    return send(reply, request, {
      status: 500,
      code: ErrorCode.INTERNAL,
      title: 'Erro interno',
      detail: 'Algo deu errado do nosso lado. O erro foi registrado.',
    });
  });

  app.setNotFoundHandler((request, reply) =>
    send(reply, request, {
      status: 404,
      code: ErrorCode.NOT_FOUND,
      title: 'Recurso não encontrado',
      detail: `${request.method} ${request.url}`,
    }),
  );
}
