import { randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { FastifyInstance, LightMyRequestResponse } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../app'
import { parseEncryptionKey, totpCode } from '../../auth'
import { loadConfig } from '../../config'
import { invites, loginAttempts, recoveryCodes, sessions, users } from '../../db/schema'
import { SESSION_COOKIE } from '../../http/session'
import { createTestDb, TEST_DATABASE_URL, type TestDb } from '../../test/test-db'
import { createChallenge } from './challenge'
import { createOwner, createUserWithInvite, OwnerExistsError, resetOwner, type NewUserInput } from './service'

const KEY_BASE64 = randomBytes(32).toString('base64')
const PUBLIC_URL = 'http://localhost:5173'
const PASSWORD = 'correct horse battery'

interface Onboarded {
  id: string
  login: string
  secret: string
  session: string
  recoveryCodes: string[]
}

/** Spins up a throwaway database and an app wired to it, plus helpers that drive the API. */
function harness() {
  const ctx = {} as { testDb: TestDb, app: FastifyInstance }

  beforeAll(async () => {
    ctx.testDb = await createTestDb()
    ctx.app = buildApp(loadConfig({ NODE_ENV: 'test', TOTP_ENCRYPTION_KEY: KEY_BASE64, PUBLIC_URL }), { db: ctx.testDb.db })
    await ctx.app.ready()
  }, 60_000)

  afterAll(async () => {
    await ctx.app?.close()
    await ctx.testDb?.drop()
  })

  // Throttling counts failures per login and per IP (all inject() calls come from 127.0.0.1).
  beforeEach(async () => {
    await ctx.testDb.db.delete(loginAttempts)
  })

  const cookieHeader = (token: string) => ({ cookie: `${SESSION_COOKIE}=${token}` })

  function sessionFrom(response: LightMyRequestResponse): string {
    const cookie = response.cookies.find((c) => c.name === SESSION_COOKIE)
    expect(cookie?.value).toBeTruthy()
    return cookie!.value
  }

  const inviteToken = (inviteUrl: string) => inviteUrl.slice(`${PUBLIC_URL}/invite/`.length)

  function openInvite(token: string) {
    return ctx.app.inject({ method: 'GET', url: `/api/invites/${token}` })
  }

  function acceptInvite(token: string, payload: { password: string, code: string }) {
    return ctx.app.inject({ method: 'POST', url: `/api/invites/${token}/accept`, payload })
  }

  async function onboard(inviteUrl: string, password = PASSWORD): Promise<Omit<Onboarded, 'id' | 'login'>> {
    const token = inviteToken(inviteUrl)
    const info = await openInvite(token)
    expect(info.statusCode).toBe(200)
    const secret = info.json().totpSecret as string
    const accepted = await acceptInvite(token, { password, code: totpCode(secret, Date.now()) })
    expect(accepted.statusCode).toBe(200)
    return { secret, session: sessionFrom(accepted), recoveryCodes: accepted.json().recoveryCodes }
  }

  async function createUser(login: string, extra: Partial<NewUserInput> = {}) {
    return createUserWithInvite(
      ctx.testDb.db,
      { login, firstName: 'Имя', lastName: login, ...extra },
      { createdBy: null, publicUrl: PUBLIC_URL },
    )
  }

  async function newUser(login: string, extra: Partial<NewUserInput> = {}): Promise<Onboarded> {
    const created = await createUser(login, extra)
    return { id: created.user.id, login, ...(await onboard(created.inviteUrl)) }
  }

  function passwordStep(login: string, password = PASSWORD) {
    return ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { login, password } })
  }

  function verify(payload: { challenge: string, code?: string, recoveryCode?: string }) {
    return ctx.app.inject({ method: 'POST', url: '/api/auth/verify', payload })
  }

  async function challengeFor(login: string): Promise<string> {
    const response = await passwordStep(login)
    expect(response.statusCode).toBe(200)
    return response.json().challenge
  }

  // The code of the next time step: the step used at invite acceptance is already spent.
  const nextCode = (secret: string) => totpCode(secret, Date.now() + 30_000)

  function me(session?: string) {
    return ctx.app.inject({ method: 'GET', url: '/api/auth/me', headers: session ? cookieHeader(session) : {} })
  }

  function call(method: 'GET' | 'POST' | 'PATCH', url: string, session: string, payload?: object) {
    return ctx.app.inject({ method, url, headers: cookieHeader(session), ...(payload ? { payload } : {}) })
  }

  return { ctx, sessionFrom, inviteToken, openInvite, acceptInvite, onboard, createUser, newUser, passwordStep, verify, challengeFor, nextCode, me, call }
}

describe.skipIf(!TEST_DATABASE_URL)('auth API (real Postgres)', () => {
  const h = harness()
  const { ctx } = h
  let owner: Onboarded

  beforeAll(async () => {
    const created = await createOwner(ctx.testDb.db, { login: 'owner', firstName: 'Ольга', lastName: 'Собственник' }, PUBLIC_URL)
    expect(created.user).toMatchObject({ role: 'owner', isAdmin: true, disabled: false })
    expect(created.inviteUrl.startsWith(`${PUBLIC_URL}/invite/`)).toBe(true)
    owner = { id: created.user.id, login: 'owner', ...(await h.onboard(created.inviteUrl)) }
  }, 30_000)

  it('answers 401 on /auth/me without a cookie', async () => {
    const response = await h.me()
    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({ error: 'unauthorized' })
  })

  it('refuses a second owner', async () => {
    await expect(createOwner(ctx.testDb.db, { login: 'owner2', firstName: 'А', lastName: 'Б' }, PUBLIC_URL)).rejects.toBeInstanceOf(OwnerExistsError)
  })

  it('walks the full path: invite → accept → me → logout → login with TOTP → me', async () => {
    const created = await h.createUser('belova', { isAdmin: false })
    const token = h.inviteToken(created.inviteUrl)

    const info = await h.openInvite(token)
    expect(info.statusCode).toBe(200)
    const body = info.json()
    expect(body).toMatchObject({ login: 'belova', firstName: 'Имя', lastName: 'belova' })
    expect(body.totpSecret).toMatch(/^[A-Z2-7]{32}$/)
    expect(body.otpauthUri).toContain('otpauth://totp/')
    expect(body.otpauthUri).toContain(`secret=${body.totpSecret}`)
    // Opening the link again shows the same pending secret.
    expect((await h.openInvite(token)).json().totpSecret).toBe(body.totpSecret)

    const accepted = await h.acceptInvite(token, { password: PASSWORD, code: totpCode(body.totpSecret, Date.now()) })
    expect(accepted.statusCode).toBe(200)
    const acceptedBody = accepted.json()
    expect(acceptedBody.me).toMatchObject({ login: 'belova', role: 'director', isAdmin: false, disabled: false })
    expect(acceptedBody.recoveryCodes).toHaveLength(10)
    const firstSession = h.sessionFrom(accepted)

    const meResponse = await h.me(firstSession)
    expect(meResponse.statusCode).toBe(200)
    expect(meResponse.json().me.id).toBe(created.user.id)

    const logout = await h.call('POST', '/api/auth/logout', firstSession)
    expect(logout.statusCode).toBe(204)
    expect(String(logout.headers['set-cookie'])).toMatch(new RegExp(`${SESSION_COOKIE}=;`))
    expect((await h.me(firstSession)).statusCode).toBe(401)

    const login = await h.passwordStep('Belova')
    expect(login.statusCode).toBe(200)
    const verified = await h.verify({ challenge: login.json().challenge, code: h.nextCode(body.totpSecret) })
    expect(verified.statusCode).toBe(200)
    expect(verified.json().me.login).toBe('belova')
    const secondSession = h.sessionFrom(verified)
    expect((await h.me(secondSession)).json().me.login).toBe('belova')

    // Only hashes are stored.
    const stored = await ctx.testDb.db.select().from(sessions).where(eq(sessions.userId, created.user.id))
    expect(stored.map((s) => s.tokenHash)).not.toContain(secondSession)
    expect(stored[0]!.ip).toBe('127.0.0.1')
    const [row] = await ctx.testDb.db.select().from(users).where(eq(users.id, created.user.id))
    expect(row!.totpSecretEnc).not.toContain(body.totpSecret)
    expect(row!.passwordHash).toMatch(/^\$argon2id\$/)
  })

  it('sets an HttpOnly, SameSite=Lax session cookie without Secure outside production', async () => {
    const created = await h.createUser('cookie.test')
    const token = h.inviteToken(created.inviteUrl)
    const secret = (await h.openInvite(token)).json().totpSecret
    const accepted = await h.acceptInvite(token, { password: PASSWORD, code: totpCode(secret, Date.now()) })
    const cookie = accepted.cookies.find((c) => c.name === SESSION_COOKIE)!
    expect(cookie.httpOnly).toBe(true)
    expect(cookie.sameSite).toBe('Lax')
    expect(cookie.secure).toBeFalsy()
    expect(cookie.path).toBe('/')
    expect(cookie.maxAge).toBe(30 * 24 * 60 * 60)
  })

  it('logs in with a recovery code exactly once', async () => {
    const user = await h.newUser('recovery')
    const code = user.recoveryCodes[0]!
    const first = await h.verify({ challenge: await h.challengeFor('recovery'), recoveryCode: code.toLowerCase() })
    expect(first.statusCode).toBe(200)
    const second = await h.verify({ challenge: await h.challengeFor('recovery'), recoveryCode: code })
    expect(second.statusCode).toBe(401)
    expect(second.json().error).toBe('invalid_code')
    const left = await ctx.testDb.db.select().from(recoveryCodes).where(eq(recoveryCodes.userId, user.id))
    expect(left).toHaveLength(9)
  })

  it('rejects a replayed TOTP code', async () => {
    const user = await h.newUser('replay')
    const code = h.nextCode(user.secret)
    expect((await h.verify({ challenge: await h.challengeFor('replay'), code })).statusCode).toBe(200)
    const replay = await h.verify({ challenge: await h.challengeFor('replay'), code })
    expect(replay.statusCode).toBe(401)
    expect(replay.json().error).toBe('invalid_code')
    // The code used at invite acceptance is spent too.
    const fresh = await h.newUser('replay2')
    const reused = await h.verify({ challenge: await h.challengeFor('replay2'), code: totpCode(fresh.secret, Date.now()) })
    expect(reused.statusCode).toBe(401)
  })

  it('answers invalid_credentials for a wrong password, an unknown login and a user who has not accepted the invite', async () => {
    await h.newUser('wrongpass')
    await h.createUser('pending')
    for (const [login, password] of [['wrongpass', 'not the password'], ['nobody', PASSWORD], ['pending', PASSWORD]] as const) {
      const response = await h.passwordStep(login, password)
      expect(response.statusCode).toBe(401)
      expect(response.json()).toMatchObject({ error: 'invalid_credentials' })
    }
    const failures = await ctx.testDb.db.select().from(loginAttempts)
    expect(failures.filter((a) => !a.success)).toHaveLength(3)
  })

  it('answers invalid_code for a wrong TOTP code and validates the input shape', async () => {
    const user = await h.newUser('wrongcode')
    const challenge = await h.challengeFor('wrongcode')
    const wrong = String((Number(h.nextCode(user.secret)) + 1) % 1_000_000).padStart(6, '0')
    const response = await h.verify({ challenge, code: wrong })
    expect(response.statusCode).toBe(401)
    expect(response.json().error).toBe('invalid_code')
    // Neither or both factors: 400 validation.
    expect((await h.verify({ challenge })).statusCode).toBe(400)
    expect((await h.verify({ challenge, code: '123456', recoveryCode: 'ABCD' })).statusCode).toBe(400)
  })

  it('throttles after 5 failed passwords, even for the right one', async () => {
    await h.newUser('throttled')
    for (let i = 0; i < 5; i++) expect((await h.passwordStep('throttled', 'wrong password')).statusCode).toBe(401)
    const blocked = await h.passwordStep('throttled')
    expect(blocked.statusCode).toBe(429)
    expect(blocked.json().error).toBe('throttled')
    expect(blocked.json().retryAfterMs).toBeGreaterThan(0)
  })

  it('throttles wrong second-factor codes the same way', async () => {
    const user = await h.newUser('throttled2')
    const challenge = await h.challengeFor('throttled2')
    for (let i = 0; i < 5; i++) {
      expect((await h.verify({ challenge, recoveryCode: 'AAAA-AAAA-AAAA-AAAA' })).statusCode).toBe(401)
    }
    const blocked = await h.verify({ challenge, code: h.nextCode(user.secret) })
    expect(blocked.statusCode).toBe(429)
    expect((await h.passwordStep('throttled2')).statusCode).toBe(429)
  })

  it('rejects expired, foreign and garbage challenges', async () => {
    const user = await h.newUser('expiry')
    const [row] = await ctx.testDb.db.select().from(users).where(eq(users.id, user.id))
    const key = parseEncryptionKey(KEY_BASE64)
    const expired = createChallenge(user.id, row!.passwordHash!, key, Date.now() - 6 * 60 * 1000)
    const foreign = createChallenge(user.id, row!.passwordHash!, randomBytes(32))
    const stale = createChallenge(user.id, 'an older password hash', key)
    for (const challenge of [expired, foreign, stale, 'garbage']) {
      const response = await h.verify({ challenge, code: h.nextCode(user.secret) })
      expect(response.statusCode).toBe(401)
      expect(response.json().error).toBe('challenge_expired')
    }
  })

  it('rejects weak passwords and wrong codes when accepting an invite', async () => {
    const created = await h.createUser('weakling.user')
    const token = h.inviteToken(created.inviteUrl)
    const secret = (await h.openInvite(token)).json().totpSecret
    const code = totpCode(secret, Date.now())

    const short = await h.acceptInvite(token, { password: 'short', code })
    expect(short.statusCode).toBe(400)
    expect(short.json()).toMatchObject({ error: 'weak_password', details: ['too_short'] })
    expect(short.json().message).toContain('10')
    const sameAsLogin = await h.acceptInvite(token, { password: 'Weakling.User', code })
    expect(sameAsLogin.statusCode).toBe(400)
    expect(sameAsLogin.json().details).toEqual(['equals_login'])

    const badCode = await h.acceptInvite(token, { password: PASSWORD, code: code === '000000' ? '111111' : '000000' })
    expect(badCode.statusCode).toBe(400)
    expect(badCode.json().error).toBe('invalid_code')

    // Nothing was spent: the invite still works.
    expect((await h.acceptInvite(token, { password: PASSWORD, code })).statusCode).toBe(200)
  })

  it('treats used, expired and unknown invites as gone (410)', async () => {
    const created = await h.createUser('once')
    await h.onboard(created.inviteUrl)
    const token = h.inviteToken(created.inviteUrl)
    expect((await h.openInvite(token)).statusCode).toBe(410)
    expect((await h.acceptInvite(token, { password: PASSWORD, code: '123456' })).json().error).toBe('invite_invalid')

    const late = await h.createUser('late')
    await ctx.testDb.db.update(invites).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(invites.userId, late.user.id))
    expect((await h.openInvite(h.inviteToken(late.inviteUrl))).statusCode).toBe(410)

    expect((await h.openInvite('no-such-token')).statusCode).toBe(410)
  })

  it('ends every session on logout-all', async () => {
    const user = await h.newUser('everywhere')
    const viaTotp = await h.verify({ challenge: await h.challengeFor('everywhere'), code: h.nextCode(user.secret) })
    const viaRecovery = await h.verify({ challenge: await h.challengeFor('everywhere'), recoveryCode: user.recoveryCodes[1]! })
    const all = [user.session, h.sessionFrom(viaTotp), h.sessionFrom(viaRecovery)]
    for (const session of all) expect((await h.me(session)).statusCode).toBe(200)

    expect((await h.call('POST', '/api/auth/logout-all', all[1]!)).statusCode).toBe(204)
    for (const session of all) expect((await h.me(session)).statusCode).toBe(401)
    expect((await ctx.testDb.db.select().from(sessions).where(eq(sessions.userId, user.id)))).toHaveLength(0)
    expect((await h.call('POST', '/api/auth/logout-all', all[0]!)).statusCode).toBe(401)
  })

  it('lets an admin create users; logins are unique case-insensitively', async () => {
    const directory = (await h.call('GET', '/api/directory', owner.session)).json()
    const positionId = directory.positions[0].id as string
    const unitId = directory.units[0].id as string

    const created = await h.call('POST', '/api/admin/users', owner.session, {
      login: 'Ivanov', firstName: 'Иван', lastName: 'Иванов', positionId, unitId, isAdmin: true,
    })
    expect(created.statusCode).toBe(201)
    const body = created.json()
    expect(body.user).toMatchObject({ login: 'ivanov', role: 'director', isAdmin: true, positionId, unitId, disabled: false })
    expect(body.inviteUrl.startsWith(`${PUBLIC_URL}/invite/`)).toBe(true)
    expect(Date.parse(body.expiresAt)).toBeGreaterThan(Date.now())

    const taken = await h.call('POST', '/api/admin/users', owner.session, { login: 'IVANOV', firstName: 'И', lastName: 'И' })
    expect(taken.statusCode).toBe(409)
    expect(taken.json().error).toBe('login_taken')

    const badRef = await h.call('POST', '/api/admin/users', owner.session, { login: 'petrov', firstName: 'П', lastName: 'П', positionId: 'nope' })
    expect(badRef.statusCode).toBe(400)
    const badLogin = await h.call('POST', '/api/admin/users', owner.session, { login: 'кириллица', firstName: 'П', lastName: 'П' })
    expect(badLogin.statusCode).toBe(400)
    expect(badLogin.json().error).toBe('validation')
  })

  it('serves the directory to any session, sorted, and 401 without one', async () => {
    const user = await h.newUser('reader')
    const response = await h.call('GET', '/api/directory', user.session)
    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.users.map((u: { login: string }) => u.login)).toContain('owner')
    expect(body.positions.length).toBeGreaterThan(0)
    expect(body.units.length).toBeGreaterThan(0)
    expect(body.users[0]).not.toHaveProperty('passwordHash')
    expect((await h.ctx.app.inject({ method: 'GET', url: '/api/directory' })).statusCode).toBe(401)
  })

  it('forbids admin routes to non-admins', async () => {
    const user = await h.newUser('plain')
    const checks = [
      await h.call('POST', '/api/admin/users', user.session, { login: 'sneaky', firstName: 'А', lastName: 'Б' }),
      await h.call('PATCH', `/api/admin/users/${user.id}`, user.session, { isAdmin: true }),
      await h.call('POST', `/api/admin/users/${owner.id}/invite`, user.session),
      await h.call('POST', `/api/admin/users/${owner.id}/disable`, user.session),
    ]
    for (const response of checks) {
      expect(response.statusCode).toBe(403)
      expect(response.json().error).toBe('forbidden')
    }
  })

  it('updates users and keeps the owner an admin', async () => {
    const user = await h.newUser('patchme')
    const promoted = await h.call('PATCH', `/api/admin/users/${user.id}`, owner.session, { isAdmin: true, firstName: 'Новое' })
    expect(promoted.statusCode).toBe(200)
    expect(promoted.json()).toMatchObject({ isAdmin: true, firstName: 'Новое', lastName: 'patchme' })
    // The new admin's existing session gets admin rights right away.
    expect((await h.call('POST', '/api/admin/users', user.session, { login: 'byadmin', firstName: 'А', lastName: 'Б' })).statusCode).toBe(201)

    const demoteOwner = await h.call('PATCH', `/api/admin/users/${owner.id}`, user.session, { isAdmin: false })
    expect(demoteOwner.statusCode).toBe(403)
    const unknown = await h.call('PATCH', '/api/admin/users/00000000-0000-4000-8000-000000000000', owner.session, { firstName: 'X' })
    expect(unknown.statusCode).toBe(404)
    expect((await h.call('PATCH', '/api/admin/users/not-a-uuid', owner.session, { firstName: 'X' })).statusCode).toBe(404)
  })

  it('resets password and 2FA with a fresh invite', async () => {
    const user = await h.newUser('forgetful')
    const first = await h.call('POST', `/api/admin/users/${user.id}/invite`, owner.session)
    expect(first.statusCode).toBe(200)
    const second = await h.call('POST', `/api/admin/users/${user.id}/invite`, owner.session)
    // Sessions are gone, the old password no longer works, the first new link was replaced.
    expect((await h.me(user.session)).statusCode).toBe(401)
    expect((await h.passwordStep('forgetful')).statusCode).toBe(401)
    expect((await h.openInvite(h.inviteToken(first.json().inviteUrl))).statusCode).toBe(410)
    expect(await ctx.testDb.db.select().from(recoveryCodes).where(eq(recoveryCodes.userId, user.id))).toHaveLength(0)

    const again = await h.onboard(second.json().inviteUrl)
    expect(again.secret).not.toBe(user.secret)
    expect((await h.me(again.session)).statusCode).toBe(200)

    // Other admins cannot reset the owner (that would hand them the owner account).
    const admin = await h.newUser('resetter', { isAdmin: true })
    expect((await h.call('POST', `/api/admin/users/${owner.id}/invite`, admin.session)).statusCode).toBe(403)
  })

  it('disables users: sessions stop working and login fails; the owner cannot be disabled', async () => {
    const user = await h.newUser('leaving')
    const disabled = await h.call('POST', `/api/admin/users/${user.id}/disable`, owner.session)
    expect(disabled.statusCode).toBe(200)
    expect(disabled.json()).toMatchObject({ id: user.id, disabled: true })
    expect((await h.me(user.session)).statusCode).toBe(401)
    const login = await h.passwordStep('leaving')
    expect(login.statusCode).toBe(401)
    expect(login.json().error).toBe('invalid_credentials')

    const directory = (await h.call('GET', '/api/directory', owner.session)).json()
    const listed = directory.users as { login: string, disabled: boolean }[]
    expect(listed.find((u) => u.login === 'leaving')?.disabled).toBe(true)
    expect(listed.at(-1)?.disabled).toBe(true)

    expect((await h.call('POST', `/api/admin/users/${user.id}/invite`, owner.session)).statusCode).toBe(409)
    expect((await h.call('POST', `/api/admin/users/${owner.id}/disable`, owner.session)).statusCode).toBe(403)
  })

  it('a challenge issued before disabling does not finish the login', async () => {
    const user = await h.newUser('midway')
    const challenge = await h.challengeFor('midway')
    await h.call('POST', `/api/admin/users/${user.id}/disable`, owner.session)
    const response = await h.verify({ challenge, code: h.nextCode(user.secret) })
    expect(response.statusCode).toBe(401)
    expect(response.json().error).toBe('challenge_expired')
  })

  it('resets the owner through the CLI service', async () => {
    const result = await resetOwner(ctx.testDb.db, PUBLIC_URL)
    expect(result?.owner.login).toBe('owner')
    expect((await h.me(owner.session)).statusCode).toBe(401)
    owner = { ...owner, ...(await h.onboard(result!.link.inviteUrl)) }
    expect((await h.me(owner.session)).json().me.role).toBe('owner')
  })
})

describe.skipIf(!TEST_DATABASE_URL)('last admin protection (no owner yet)', () => {
  const h = harness()

  it('never leaves the system without an active admin', async () => {
    const first = await h.newUser('admin.a', { isAdmin: true })
    const second = await h.newUser('admin.b', { isAdmin: true })

    const demoteB = await h.call('PATCH', `/api/admin/users/${second.id}`, first.session, { isAdmin: false })
    expect(demoteB.statusCode).toBe(200)

    const demoteSelf = await h.call('PATCH', `/api/admin/users/${first.id}`, first.session, { isAdmin: false })
    expect(demoteSelf.statusCode).toBe(409)
    expect(demoteSelf.json().error).toBe('last_admin')
    const disableSelf = await h.call('POST', `/api/admin/users/${first.id}/disable`, first.session)
    expect(disableSelf.statusCode).toBe(409)
    expect(disableSelf.json().error).toBe('last_admin')
    expect((await h.call('PATCH', `/api/admin/users/${first.id}`, second.session, { isAdmin: false })).statusCode).toBe(403)

    // With a second admin back, the first one may go.
    expect((await h.call('PATCH', `/api/admin/users/${second.id}`, first.session, { isAdmin: true })).statusCode).toBe(200)
    expect((await h.call('POST', `/api/admin/users/${first.id}/disable`, second.session)).statusCode).toBe(200)
    expect((await h.me(first.session)).statusCode).toBe(401)
  })
})
