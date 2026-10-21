import {
  AcceptInviteInput,
  CreateUserInput,
  LoginInput,
  UpdateUserInput,
  VerifyInput,
  type AcceptInviteResponse,
  type CreateUserResponse,
  type DirectoryResponse,
  type InviteInfo,
  type InviteLinkResponse,
  type LoginResponse,
  type MeResponse,
  type UserDto,
} from '@car-city/shared/model'
import { and, eq, isNull } from 'drizzle-orm'
import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import { z } from 'zod'
import {
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  hashPassword,
  otpauthUri,
  parseEncryptionKey,
  PASSWORD_PROBLEM_MESSAGES,
  validatePasswordPolicy,
  verifyPassword,
  verifyPasswordDummy,
  verifyTotp,
} from '../../auth'
import type { Db } from '../../db/client'
import { invites, pushSubscriptions, recoveryCodes, sessions, users, type User } from '../../db/schema'
import { apiError } from '../../http/errors'
import { clearSessionCookie, requireActor, requireAdmin, setSessionCookie } from '../../http/session'
import type { ModuleOptions } from '../types'
import { createChallenge, passwordFingerprint, readChallenge } from './challenge'
import {
  assertReferences,
  createSession,
  createUserWithInvite,
  findOpenInvite,
  findUserById,
  findUserByLogin,
  loadDirectory,
  lockActiveAdmins,
  loginThrottle,
  recordLoginAttempt,
  resetAccessAndInvite,
  toUserDto,
  verifySecondFactor,
  type ClientMeta,
} from './service'

const IdParams = z.object({ id: z.string() })
const TokenParams = z.object({ token: z.string().min(1).max(256) })

// Invite URLs carry the token, so these routes do not write the per-request info logs (which include the URL).
const QUIET = { logLevel: 'warn' } as const

const INVALID_CREDENTIALS = 'Неверный логин или пароль'
const INVALID_CODE = 'Неверный код'

function clientMeta(request: FastifyRequest): ClientMeta {
  const userAgent = request.headers['user-agent']
  return { userAgent: typeof userAgent === 'string' ? userAgent : null, ip: request.ip || null }
}

async function assertNotThrottled(db: Db, login: string, ip: string | null, now: number): Promise<void> {
  const decision = await loginThrottle(db, login, ip, now)
  if (!decision.allowed) {
    throw apiError(429, 'throttled', { message: 'Слишком много попыток, попробуйте позже', retryAfterMs: decision.retryAfterMs })
  }
}

async function loadTarget(db: Db, params: unknown): Promise<User> {
  const user = await findUserById(db, IdParams.parse(params).id)
  if (!user) throw apiError(404, 'not_found')
  return user
}

/** Login with 2FA, invites, admin user management, directory. Routes: packages/shared/src/model/api.ts. */
export const authRoutes: FastifyPluginAsync<ModuleOptions> = async (app, { db, config }) => {
  const encryptionKey = config.TOTP_ENCRYPTION_KEY ? parseEncryptionKey(config.TOTP_ENCRYPTION_KEY) : null
  if (!encryptionKey) app.log.warn('TOTP_ENCRYPTION_KEY is not set: login and invites will fail')
  const key = (): Buffer => {
    if (!encryptionKey) throw new Error('TOTP_ENCRYPTION_KEY is not configured')
    return encryptionKey
  }
  const secureCookie = config.NODE_ENV === 'production'

  // ---------- login ----------

  app.post('/auth/login', async (request): Promise<LoginResponse> => {
    const input = LoginInput.parse(request.body)
    const now = Date.now()
    const ip = request.ip || null
    await assertNotThrottled(db, input.login, ip, now)

    const user = await findUserByLogin(db, input.login)
    // Unknown, disabled and not-yet-onboarded users cost the same argon2 run as a wrong password.
    const usable = user && !user.disabledAt && user.totpEnabled && user.passwordHash ? user : null
    const ok = usable
      ? await verifyPassword(usable.passwordHash!, input.password)
      : await verifyPasswordDummy(input.password)
    if (!usable || !ok) {
      await recordLoginAttempt(db, input.login, ip, false, now)
      throw apiError(401, 'invalid_credentials', { message: INVALID_CREDENTIALS })
    }
    return { challenge: createChallenge(usable.id, usable.passwordHash!, key(), now) }
  })

  app.post('/auth/verify', async (request, reply): Promise<MeResponse> => {
    const input = VerifyInput.parse(request.body)
    const now = Date.now()
    const ip = request.ip || null
    const expired = () => apiError(401, 'challenge_expired', { message: 'Время на ввод кода истекло, войдите заново' })

    const challenge = readChallenge(input.challenge, key(), now)
    if (!challenge) throw expired()
    const user = await findUserById(db, challenge.userId)
    if (!user || user.disabledAt || !user.totpEnabled || !user.passwordHash) throw expired()
    if (passwordFingerprint(user.passwordHash) !== challenge.passwordFingerprint) throw expired()

    await assertNotThrottled(db, user.login, ip, now)
    const secret = user.totpSecretEnc ? decryptSecret(user.totpSecretEnc, key()) : null
    const ok = await verifySecondFactor(db, user, secret, input, now)
    if (!ok) {
      await recordLoginAttempt(db, user.login, ip, false, now)
      throw apiError(401, 'invalid_code', { message: INVALID_CODE })
    }

    const token = await createSession(db, user.id, clientMeta(request), new Date(now))
    await recordLoginAttempt(db, user.login, ip, true, now)
    setSessionCookie(reply, token, secureCookie)
    return { me: toUserDto(user) }
  })

  // Idempotent: without a session it still clears the cookie.
  app.post('/auth/logout', async (request, reply) => {
    if (request.actor) await db.delete(sessions).where(eq(sessions.id, request.actor.sessionId))
    clearSessionCookie(reply)
    return reply.code(204).send()
  })

  app.post('/auth/logout-all', async (request, reply) => {
    const actor = requireActor(request)
    await db.delete(sessions).where(eq(sessions.userId, actor.id))
    // Other devices must stop receiving pushes too, not just lose their session.
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, actor.id))
    clearSessionCookie(reply)
    return reply.code(204).send()
  })

  app.get('/auth/me', async (request): Promise<MeResponse> => {
    const actor = requireActor(request)
    const user = await findUserById(db, actor.id)
    if (!user) throw apiError(401, 'unauthorized')
    return { me: toUserDto(user) }
  })

  // ---------- invites ----------

  app.get('/invites/:token', QUIET, async (request): Promise<InviteInfo> => {
    const { token } = TokenParams.parse(request.params)
    const found = await findOpenInvite(db, token, new Date())
    if (!found) throw apiError(410, 'invite_invalid', { message: 'Ссылка-приглашение недействительна или устарела' })
    const { user } = found

    let secretEnc = user.totpSecretEnc
    if (!secretEnc) {
      // Conditional write: two tabs opening the link at once end up with the same secret.
      const [row] = await db
        .update(users)
        .set({ totpSecretEnc: encryptSecret(generateTotpSecret(), key()), totpEnabled: false })
        .where(and(eq(users.id, user.id), isNull(users.totpSecretEnc)))
        .returning({ totpSecretEnc: users.totpSecretEnc })
      secretEnc = row?.totpSecretEnc ?? (await findUserById(db, user.id))?.totpSecretEnc ?? null
      if (!secretEnc) throw apiError(410, 'invite_invalid')
    }
    const secret = decryptSecret(secretEnc, key())
    return {
      login: user.login,
      firstName: user.firstName,
      lastName: user.lastName,
      totpSecret: secret,
      otpauthUri: otpauthUri({ secret, account: user.login }),
    }
  })

  app.post('/invites/:token/accept', QUIET, async (request, reply): Promise<AcceptInviteResponse> => {
    const { token } = TokenParams.parse(request.params)
    const input = AcceptInviteInput.parse(request.body)
    const now = new Date()
    const invalid = () => apiError(410, 'invite_invalid', { message: 'Ссылка-приглашение недействительна или устарела' })

    const found = await findOpenInvite(db, token, now)
    if (!found) throw invalid()
    const { invite, user } = found
    // The 6-digit code is guessable in principle, so wrong codes count against the same limits as login.
    const ip = request.ip || null
    await assertNotThrottled(db, user.login, ip, now.getTime())

    const problems = validatePasswordPolicy(input.password, { login: user.login })
    if (problems.length > 0) {
      throw apiError(400, 'weak_password', {
        message: problems.map((problem) => PASSWORD_PROBLEM_MESSAGES[problem]).join('. '),
        details: problems,
      })
    }
    const secretEnc = user.totpSecretEnc
    if (!secretEnc) throw apiError(400, 'invalid_code', { message: 'Сначала откройте ссылку и добавьте ключ в приложение' })
    const step = verifyTotp(decryptSecret(secretEnc, key()), input.code, now.getTime(), { lastUsedStep: user.totpLastStep })
    if (step === null) {
      await recordLoginAttempt(db, user.login, ip, false, now.getTime())
      throw apiError(400, 'invalid_code', { message: INVALID_CODE })
    }

    const passwordHash = await hashPassword(input.password)
    const recovery = generateRecoveryCodes()
    const result = await db.transaction(async (tx) => {
      const used = await tx
        .update(invites)
        .set({ usedAt: now })
        .where(and(eq(invites.id, invite.id), isNull(invites.usedAt)))
        .returning({ id: invites.id })
      if (used.length === 0) throw invalid()
      // Guarded by the secret the code was checked against, in case of a concurrent reset.
      const [row] = await tx
        .update(users)
        .set({ passwordHash, totpEnabled: true, totpLastStep: step })
        .where(and(eq(users.id, user.id), eq(users.totpSecretEnc, secretEnc), isNull(users.disabledAt)))
        .returning()
      if (!row) throw invalid()
      await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, user.id))
      await tx.insert(recoveryCodes).values(recovery.hashes.map((codeHash) => ({ userId: user.id, codeHash })))
      await tx.delete(sessions).where(eq(sessions.userId, user.id))
      const sessionToken = await createSession(tx, user.id, clientMeta(request), now)
      return { row, sessionToken }
    })

    setSessionCookie(reply, result.sessionToken, secureCookie)
    return { me: toUserDto(result.row), recoveryCodes: recovery.codes }
  })

  // ---------- directory ----------

  app.get('/directory', async (request): Promise<DirectoryResponse> => {
    requireActor(request)
    return loadDirectory(db)
  })

  // ---------- admin ----------

  app.post('/admin/users', async (request, reply): Promise<CreateUserResponse> => {
    const actor = requireAdmin(request)
    const input = CreateUserInput.parse(request.body)
    await assertReferences(db, input)
    const created = await createUserWithInvite(
      db,
      { ...input, role: 'director' },
      { createdBy: actor.id, publicUrl: config.PUBLIC_URL },
    )
    reply.code(201)
    return created
  })

  app.patch('/admin/users/:id', async (request): Promise<UserDto> => {
    requireAdmin(request)
    const target = await loadTarget(db, request.params)
    const input = UpdateUserInput.parse(request.body)
    await assertReferences(db, input)

    const updated = await db.transaction(async (tx) => {
      const demoting = input.isAdmin === false
      const admins = demoting ? await lockActiveAdmins(tx) : []
      const [current] = await tx.select().from(users).where(eq(users.id, target.id)).for('update')
      if (!current) throw apiError(404, 'not_found')
      if (demoting && current.isAdmin) {
        if (current.role === 'owner') throw apiError(403, 'forbidden', { message: 'Собственник всегда остаётся администратором' })
        if (!current.disabledAt && !admins.some((admin) => admin.id !== current.id)) {
          throw apiError(409, 'last_admin', { message: 'Нельзя снять последнего администратора' })
        }
      }
      const patch: Partial<Pick<User, 'firstName' | 'lastName' | 'positionId' | 'unitId' | 'isAdmin'>> = {}
      if (input.firstName !== undefined) patch.firstName = input.firstName
      if (input.lastName !== undefined) patch.lastName = input.lastName
      if (input.positionId !== undefined) patch.positionId = input.positionId
      if (input.unitId !== undefined) patch.unitId = input.unitId
      if (input.isAdmin !== undefined) patch.isAdmin = input.isAdmin
      if (Object.keys(patch).length === 0) return current
      const [row] = await tx.update(users).set(patch).where(eq(users.id, current.id)).returning()
      return row!
    })
    return toUserDto(updated)
  })

  app.post('/admin/users/:id/invite', async (request): Promise<InviteLinkResponse> => {
    const actor = requireAdmin(request)
    const target = await loadTarget(db, request.params)
    // Only the owner may reset the owner: otherwise any admin could take over the owner account.
    if (target.role === 'owner' && actor.id !== target.id) {
      throw apiError(403, 'forbidden', { message: 'Доступ собственника сбрасывается только через консоль сервера' })
    }
    if (target.disabledAt) throw apiError(409, 'conflict', { message: 'Пользователь отключён' })
    const link = await resetAccessAndInvite(db, target.id, { createdBy: actor.id, publicUrl: config.PUBLIC_URL })
    if (!link) throw apiError(404, 'not_found')
    return link
  })

  app.post('/admin/users/:id/disable', async (request): Promise<UserDto> => {
    requireAdmin(request)
    const target = await loadTarget(db, request.params)
    if (target.role === 'owner') throw apiError(403, 'forbidden', { message: 'Собственника нельзя отключить' })

    const updated = await db.transaction(async (tx) => {
      const admins = await lockActiveAdmins(tx)
      const [current] = await tx.select().from(users).where(eq(users.id, target.id)).for('update')
      if (!current) throw apiError(404, 'not_found')
      if (current.disabledAt) return current
      if (current.isAdmin && !admins.some((admin) => admin.id !== current.id)) {
        throw apiError(409, 'last_admin', { message: 'Нельзя отключить последнего администратора' })
      }
      const [row] = await tx.update(users).set({ disabledAt: new Date() }).where(eq(users.id, current.id)).returning()
      await tx.delete(sessions).where(eq(sessions.userId, current.id))
      await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, current.id))
      await tx.delete(invites).where(and(eq(invites.userId, current.id), isNull(invites.usedAt)))
      return row!
    })
    return toUserDto(updated)
  })
}
