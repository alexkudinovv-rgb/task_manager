import type { ApiError, ApiErrorCode } from '@car-city/shared/model'
import type { FastifyInstance } from 'fastify'
import { ZodError } from 'zod'

/** Throw from a route to answer with an ApiError body (see packages/shared/src/model/api.ts). */
export class ApiHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError,
  ) {
    super(body.message ?? body.error)
  }
}

export function apiError(status: number, error: ApiErrorCode, extra: Omit<ApiError, 'error'> = {}): ApiHttpError {
  return new ApiHttpError(status, { error, ...extra })
}

const CLIENT_ERROR_MESSAGES: Record<number, string> = {
  413: 'Слишком большой запрос',
  415: 'Неподдерживаемый формат запроса',
}

export function installErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiHttpError) return reply.code(error.status).send(error.body)
    // Schemas are parsed with zod inside handlers: Input.parse(request.body).
    if (error instanceof ZodError) return reply.code(400).send({ error: 'validation', details: error.issues } satisfies ApiError)
    const status = typeof (error as { statusCode?: unknown }).statusCode === 'number' ? (error as { statusCode: number }).statusCode : 500
    // Fastify's own client errors (malformed JSON, body too large, ...): a generic text for the client,
    // the internal message only in the log.
    if (status < 500) {
      request.log.debug({ err: error }, 'client error')
      const message = CLIENT_ERROR_MESSAGES[status] ?? 'Некорректный запрос'
      return reply.code(status).send({ error: 'validation', message } satisfies ApiError)
    }
    request.log.error(error)
    return reply.code(500).send({ error: 'internal' } satisfies ApiError)
  })
}
