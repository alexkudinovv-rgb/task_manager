import { API_ERROR_CODES, type ApiError, type ApiErrorCode } from '@car-city/shared/model'

/** Non-2xx answer from the server, carrying the contract's ApiError body. */
export class ApiRequestError extends Error {
  readonly status: number
  readonly body: ApiError

  constructor(status: number, body: ApiError) {
    super(body.message ?? body.error)
    this.name = 'ApiRequestError'
    this.status = status
    this.body = body
  }

  get code(): ApiErrorCode {
    return this.body.error
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

// The server mounts every route under /api; the dev server proxies it to the same origin.
const API_ROOT = '/api'

// Auth and invite routes answer 401 as part of their own flow; elsewhere it means the session ended.
const AUTH_FLOW = /^\/(auth|invites)\//

let unauthorizedHandler: (() => void) | null = null

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler
}

export async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  // No Content-Type without a body: the server rejects an empty JSON body.
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  const response = await fetch(API_ROOT + path, {
    method,
    credentials: 'same-origin',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  if (response.status === 204) return undefined as T
  const data = await readJson(response)
  if (response.ok) return data as T

  if (response.status === 401 && !AUTH_FLOW.test(path)) unauthorizedHandler?.()
  throw new ApiRequestError(response.status, toApiError(data, response.status))
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function isApiError(data: unknown): data is ApiError {
  if (typeof data !== 'object' || data === null) return false
  const code = (data as { error?: unknown }).error
  return typeof code === 'string' && (API_ERROR_CODES as readonly string[]).includes(code)
}

/** Proxies and crashes may answer without an ApiError body; fall back on the status. */
function toApiError(data: unknown, status: number): ApiError {
  if (isApiError(data)) return data
  const byStatus: Record<number, ApiErrorCode> = {
    400: 'validation',
    401: 'unauthorized',
    403: 'forbidden',
    404: 'not_found',
    409: 'conflict',
    410: 'invite_invalid',
    429: 'throttled',
  }
  return { error: byStatus[status] ?? 'internal' }
}
