import type { Role } from '@car-city/shared/model'
import { and, eq, gt, isNull } from 'drizzle-orm'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { hashToken, SESSION_TTL_MS } from '../auth'
import type { Db } from '../db/client'
import { sessions, users } from '../db/schema'
import { apiError } from './errors'

export const SESSION_COOKIE = 'cc_session'

/** Who is making the request, resolved from the session cookie. */
export interface RequestActor {
  id: string
  role: Role
  isAdmin: boolean
  sessionId: string
}

declare module 'fastify' {
  interface FastifyRequest {
    actor: RequestActor | null
  }
}

/**
 * Resolves `request.actor` for /api requests. The cookie holds a random token; the database keeps
 * only its SHA-256 (sessions.token_hash). Expired sessions and disabled users resolve to null.
 */
export function installSessionAuth(app: FastifyInstance, db: Db): void {
  app.decorateRequest('actor', null)
  app.addHook('onRequest', async (request) => {
    request.actor = null
    if (!request.url.startsWith('/api/')) return
    const token = request.cookies[SESSION_COOKIE]
    if (!token) return
    const [row] = await db
      .select({ sessionId: sessions.id, id: users.id, role: users.role, isAdmin: users.isAdmin })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date()), isNull(users.disabledAt)))
      .limit(1)
    if (row) request.actor = row
  })
}

export function requireActor(request: FastifyRequest): RequestActor {
  if (!request.actor) throw apiError(401, 'unauthorized')
  return request.actor
}

export function requireAdmin(request: FastifyRequest): RequestActor {
  const actor = requireActor(request)
  if (!actor.isAdmin) throw apiError(403, 'forbidden')
  return actor
}

export function setSessionCookie(reply: FastifyReply, token: string, secure: boolean): void {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  })
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' })
}
