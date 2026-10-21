import { randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../../app'
import { hashToken } from '../../auth'
import { loadConfig } from '../../config'
import { pushSubscriptions, sessions, users } from '../../db/schema'
import { createTestDb, TEST_DATABASE_URL, type TestDb } from '../../test/test-db'
import { isAllowedEndpoint, sendPushToUsers } from './service'

const webpush = vi.hoisted(() => ({ setVapidDetails: vi.fn(), sendNotification: vi.fn() }))
vi.mock('web-push', () => ({ default: webpush, ...webpush }))

type Who = 'alpha' | 'beta'
type Method = 'GET' | 'POST' | 'DELETE'

const PUBLIC_KEY = 'BPublicKeyForTests'
const env = { NODE_ENV: 'test', VAPID_PUBLIC_KEY: PUBLIC_KEY, VAPID_PRIVATE_KEY: 'private-key-for-tests' }
const endpoint = (n: number) => `https://fcm.googleapis.com/fcm/send/test-${n}`
const subscription = (n: number, auth = 'auth-1') => ({ endpoint: endpoint(n), keys: { p256dh: 'p256dh-1', auth } })
const statusError = (statusCode: number) => Object.assign(new Error(`push service said ${statusCode}`), { statusCode })

describe('isAllowedEndpoint', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://FCM.googleapis.com:443/fcm/send/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/gAAA',
    'https://web.push.apple.com/QGx',
    'https://api.push.apple.com/3/device/x',
    'https://db5p.notify.windows.com/w/?token=x',
    'https://wns2-by3p.wns.windows.com/w/?token=x',
  ])('accepts %s', (url) => {
    expect(isAllowedEndpoint(url)).toBe(true)
  })

  it.each([
    'http://fcm.googleapis.com/fcm/send/abc',
    'https://fcm.googleapis.com:8443/fcm/send/abc',
    'https://user:pass@fcm.googleapis.com/x',
    'https://127.0.0.1.nip.io/x',
    'https://localhost/x',
    'https://127.0.0.1/x',
    'https://[::1]/x',
    'https://10.0.0.5/x',
    'https://evilfcm.googleapis.com.attacker.com/x',
    'https://fcm.googleapis.com.attacker.com/x',
    'https://evilfcm.googleapis.com/x',
    'https://evilpush.apple.com/x',
    'https://notify.windows.com.evil.io/x',
    'https://push.services.mozilla.com/x',
    'not a url',
  ])('rejects %s', (url) => {
    expect(isAllowedEndpoint(url)).toBe(false)
  })
})

describe.skipIf(!TEST_DATABASE_URL)('push API', { timeout: 20_000 }, () => {
  let testDb: TestDb
  let app: FastifyInstance
  let bare: FastifyInstance
  let vapidCalls: unknown[][] = []
  const ids = {} as Record<Who, string>
  const tokens = {} as Record<Who, string>

  beforeAll(async () => {
    testDb = await createTestDb()
    app = buildApp(loadConfig(env), { db: testDb.db })
    bare = buildApp(loadConfig({ NODE_ENV: 'test' }), { db: testDb.db })
    await Promise.all([app.ready(), bare.ready()])
    // Mocks may be cleared between tests; keep what plugin registration did.
    vapidCalls = [...webpush.setVapidDetails.mock.calls]
    for (const who of ['alpha', 'beta'] as const) {
      const [user] = await testDb.db
        .insert(users)
        .values({ login: who, firstName: who, lastName: 'Тестов', role: 'director', passwordHash: 'x' })
        .returning()
      const token = randomBytes(32).toString('base64url')
      await testDb.db
        .insert(sessions)
        .values({ userId: user!.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 86_400_000) })
      ids[who] = user!.id
      tokens[who] = token
    }
  }, 60_000)

  afterAll(async () => {
    await app?.close()
    await bare?.close()
    testDb?.pool.on('error', () => {})
    await testDb?.drop()
  }, 60_000)

  beforeEach(async () => {
    webpush.sendNotification.mockReset()
    webpush.sendNotification.mockResolvedValue({ statusCode: 201, body: '', headers: {} })
    await testDb.db.delete(pushSubscriptions)
  })

  const call = (who: Who | null, method: Method, url: string, payload?: object, on?: FastifyInstance) =>
    (on ?? app).inject({ method, url, payload, cookies: who ? { cc_session: tokens[who] } : {} })

  const rows = () => testDb.db.select().from(pushSubscriptions)

  it('requires a session', async () => {
    expect((await call(null, 'GET', '/api/push/public-key')).statusCode).toBe(401)
    expect((await call(null, 'POST', '/api/push/subscriptions', subscription(1))).statusCode).toBe(401)
    expect((await call(null, 'DELETE', '/api/push/subscriptions', { endpoint: endpoint(1) })).statusCode).toBe(401)
    const response = await call(null, 'POST', '/api/push/test')
    expect(response.statusCode).toBe(401)
    expect(response.json()).toMatchObject({ error: 'unauthorized' })
    expect(await rows()).toHaveLength(0)
  })

  it('returns the public key, or null when push is not configured', async () => {
    expect((await call('alpha', 'GET', '/api/push/public-key')).json()).toEqual({ publicKey: PUBLIC_KEY })
    expect((await call('alpha', 'GET', '/api/push/public-key', undefined, bare)).json()).toEqual({ publicKey: null })
    expect(vapidCalls).toEqual([['mailto:admin@car-city.local', PUBLIC_KEY, 'private-key-for-tests']])
  })

  it('upserts a subscription by endpoint and hands it over to whoever subscribes last', async () => {
    expect((await call('alpha', 'POST', '/api/push/subscriptions', subscription(1))).statusCode).toBe(204)
    expect((await call('alpha', 'POST', '/api/push/subscriptions', subscription(1, 'auth-2'))).statusCode).toBe(204)
    let all = await rows()
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ userId: ids.alpha, endpoint: endpoint(1), auth: 'auth-2' })

    // Same phone, another login.
    expect((await call('beta', 'POST', '/api/push/subscriptions', subscription(1, 'auth-3'))).statusCode).toBe(204)
    all = await rows()
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ userId: ids.beta, auth: 'auth-3' })
  })

  it('rejects malformed input and non-public endpoints', async () => {
    expect((await call('alpha', 'POST', '/api/push/subscriptions', { endpoint: endpoint(1) })).statusCode).toBe(400)
    const internal = { endpoint: 'https://127.0.0.1:5432/x', keys: { p256dh: 'a', auth: 'b' } }
    const response = await call('alpha', 'POST', '/api/push/subscriptions', internal)
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: 'validation' })
    expect(await rows()).toHaveLength(0)
  })

  it('unsubscribes only the current user', async () => {
    await call('beta', 'POST', '/api/push/subscriptions', subscription(1))
    expect((await call('alpha', 'DELETE', '/api/push/subscriptions', { endpoint: endpoint(1) })).statusCode).toBe(204)
    expect(await rows()).toHaveLength(1)
    expect((await call('beta', 'DELETE', '/api/push/subscriptions', { endpoint: endpoint(1) })).statusCode).toBe(204)
    expect(await rows()).toHaveLength(0)
  })

  it('sends a test notification to every subscription of the user', async () => {
    await call('alpha', 'POST', '/api/push/subscriptions', subscription(1))
    await call('alpha', 'POST', '/api/push/subscriptions', subscription(2))
    await call('beta', 'POST', '/api/push/subscriptions', subscription(3))

    expect((await call('alpha', 'POST', '/api/push/test')).statusCode).toBe(204)
    expect(webpush.sendNotification).toHaveBeenCalledTimes(2)
    const sentTo = webpush.sendNotification.mock.calls.map(([sub]) => (sub as { endpoint: string }).endpoint).sort()
    expect(sentTo).toEqual([endpoint(1), endpoint(2)])
    const [sub, body, options] = webpush.sendNotification.mock.calls[0]!
    expect(sub).toMatchObject({ keys: { p256dh: 'p256dh-1', auth: 'auth-1' } })
    expect(JSON.parse(body as string)).toEqual({ title: 'Car City · Задачи', body: 'Тестовое уведомление', url: '/' })
    expect(options).toMatchObject({ TTL: 86_400, urgency: 'high' })
  })

  it('deletes subscriptions the push service reports gone and keeps the rest', async () => {
    await call('alpha', 'POST', '/api/push/subscriptions', subscription(1))
    await call('alpha', 'POST', '/api/push/subscriptions', subscription(2))
    await call('alpha', 'POST', '/api/push/subscriptions', subscription(3))
    webpush.sendNotification.mockImplementation(async (s: { endpoint: string }) => {
      if (s.endpoint === endpoint(1)) throw statusError(410)
      if (s.endpoint === endpoint(2)) throw statusError(500)
      return { statusCode: 201, body: '', headers: {} }
    })

    expect((await call('alpha', 'POST', '/api/push/test')).statusCode).toBe(204)
    const left = (await rows()).map((r) => r.endpoint).sort()
    expect(left).toEqual([endpoint(2), endpoint(3)])
  })

  it('sendPushToUsers reports what happened and skips users without subscriptions', async () => {
    await call('alpha', 'POST', '/api/push/subscriptions', subscription(1))
    await call('beta', 'POST', '/api/push/subscriptions', subscription(2))
    webpush.sendNotification.mockImplementation(async (s: { endpoint: string }) => {
      if (s.endpoint === endpoint(2)) throw statusError(404)
      return { statusCode: 201, body: '', headers: {} }
    })
    const log = { warn: vi.fn() }
    const result = await sendPushToUsers(testDb.db, loadConfig(env), [ids.alpha, ids.beta], { title: 't', body: 'b' }, { log })
    expect(result).toEqual({ sent: 1, removed: 1, failed: 0 })
    expect(await testDb.db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, ids.beta))).toHaveLength(0)
    expect(log.warn).not.toHaveBeenCalled()
  })

  it('refuses the test push when push is not configured', async () => {
    await call('alpha', 'POST', '/api/push/subscriptions', subscription(1))
    const response = await call('alpha', 'POST', '/api/push/test', undefined, bare)
    expect(response.statusCode).toBe(409)
    expect(webpush.sendNotification).not.toHaveBeenCalled()
  })
})
