import { randomBytes, randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import type { MessageDto, MessagesPage, Task, UnreadDto, WsEvent } from '@car-city/shared/model'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { buildApp } from '../../app'
import { hashToken } from '../../auth'
import { loadConfig } from '../../config'
import { messages, sessions, users } from '../../db/schema'
import { createTestDb, TEST_DATABASE_URL, type TestDb } from '../../test/test-db'

type Who = 'owner' | 'alpha' | 'beta' | 'gamma' | 'eps' | 'kappa' | 'zeta'
type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE'

const MINUTE = 60_000

describe.skipIf(!TEST_DATABASE_URL)('chats API', { timeout: 20_000 }, () => {
  let testDb: TestDb
  let app: FastifyInstance
  const ids = {} as Record<Who, string>
  const tokens = {} as Record<Who, string>
  let shared: Task // alpha -> beta; gamma can't see it
  let privateTask: Task // alpha only

  beforeAll(async () => {
    testDb = await createTestDb()
    app = buildApp(loadConfig({ NODE_ENV: 'test' }), { db: testDb.db })
    await app.ready()
    const people: Who[] = ['owner', 'alpha', 'beta', 'gamma', 'eps', 'kappa', 'zeta']
    for (const who of people) {
      const owner = who === 'owner'
      const [user] = await testDb.db
        .insert(users)
        .values({
          login: who,
          firstName: who,
          lastName: 'Тестов',
          role: owner ? 'owner' : 'director',
          isAdmin: owner,
          passwordHash: 'x',
          disabledAt: who === 'zeta' ? new Date() : null,
        })
        .returning()
      const token = randomBytes(32).toString('base64url')
      await testDb.db
        .insert(sessions)
        .values({ userId: user!.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 86_400_000) })
      ids[who] = user!.id
      tokens[who] = token
    }
    shared = await createTask('alpha', ids.beta)
    privateTask = await createTask('alpha', ids.alpha)
  }, 60_000)

  afterAll(async () => {
    await app?.close()
    testDb?.pool.on('error', () => {})
    await testDb?.drop()
  }, 60_000)

  const call = (who: Who | null, method: Method, url: string, payload?: object) =>
    app.inject({ method, url, payload, cookies: who ? { cc_session: tokens[who] } : {} })

  async function createTask(who: Who, responsibleId: string): Promise<Task> {
    const response = await call(who, 'POST', '/api/tasks', { title: 'Задача', dueDate: '2026-11-20', responsibleId })
    expect(response.statusCode, response.body).toBe(201)
    return response.json<Task>()
  }

  async function post(who: Who, chatKey: string, body: string): Promise<MessageDto> {
    const response = await call(who, 'POST', `/api/chats/${chatKey}/messages`, { body })
    expect(response.statusCode, response.body).toBe(201)
    return response.json<MessageDto>()
  }

  async function page(who: Who, chatKey: string, query = ''): Promise<MessagesPage> {
    const response = await call(who, 'GET', `/api/chats/${chatKey}/messages${query}`)
    expect(response.statusCode, response.body).toBe(200)
    return response.json<MessagesPage>()
  }

  async function unread(who: Who): Promise<UnreadDto> {
    const response = await call(who, 'GET', '/api/chats/unread')
    expect(response.statusCode).toBe(200)
    return response.json<UnreadDto>()
  }

  async function insertMessage(taskId: string | null, author: Who, body: string, createdAt: Date) {
    const [row] = await testDb.db.insert(messages).values({ taskId, authorId: ids[author], body, createdAt }).returning()
    return row!
  }

  it('requires a session', async () => {
    expect((await call(null, 'GET', '/api/chats/general/messages')).statusCode).toBe(401)
    expect((await call(null, 'POST', '/api/chats/general/messages', { body: 'x' })).statusCode).toBe(401)
    expect((await call(null, 'GET', '/api/chats/unread')).statusCode).toBe(401)
  })

  it('lets everyone use the general chat', async () => {
    const message = await post('alpha', 'general', '  Всем привет  ')
    expect(message).toMatchObject({
      chatKey: 'general',
      taskId: null,
      authorId: ids.alpha,
      body: 'Всем привет',
      editedAt: null,
      deleted: false,
      mentions: [],
      attachments: [],
    })
    expect((await page('gamma', 'general')).messages.map((m) => m.id)).toContain(message.id)
  })

  it('follows task visibility in task chats', async () => {
    const message = await post('beta', shared.id, 'Взял')
    expect(message).toMatchObject({ chatKey: shared.id, taskId: shared.id })
    expect((await page('owner', shared.id)).messages.map((m) => m.id)).toContain(message.id)
    expect((await page('alpha', shared.id)).messages.map((m) => m.id)).toContain(message.id)

    const attempts: [Method, string, object | undefined][] = [
      ['GET', `/api/chats/${shared.id}/messages`, undefined],
      ['POST', `/api/chats/${shared.id}/messages`, { body: 'x' }],
      ['POST', `/api/chats/${shared.id}/read`, undefined],
      ['PATCH', `/api/messages/${message.id}`, { body: 'x' }],
      ['DELETE', `/api/messages/${message.id}`, undefined],
    ]
    for (const [method, url, payload] of attempts) {
      expect((await call('gamma', method, url, payload)).statusCode, `${method} ${url}`).toBe(404)
    }
    expect((await call('alpha', 'GET', `/api/chats/${randomUUID()}/messages`)).statusCode).toBe(404)
    expect((await call('alpha', 'GET', '/api/chats/nonsense/messages')).statusCode).toBe(404)
  })

  it('validates input', async () => {
    expect((await call('alpha', 'POST', '/api/chats/general/messages', { body: '   ' })).statusCode).toBe(400)
    expect((await call('alpha', 'POST', '/api/chats/general/messages', { body: 'x'.repeat(4001) })).statusCode).toBe(400)
    expect((await call('alpha', 'GET', '/api/chats/general/messages?limit=0')).statusCode).toBe(400)
    expect((await call('alpha', 'GET', '/api/chats/general/messages?limit=101')).statusCode).toBe(400)
    expect((await call('alpha', 'GET', '/api/chats/general/messages?before=yesterday')).statusCode).toBe(400)
  })

  it('pages newest first with a `before` cursor', async () => {
    const task = await createTask('alpha', ids.alpha)
    const base = Date.now() - 60 * MINUTE
    for (let i = 0; i < 7; i++) await insertMessage(task.id, 'alpha', `#${i}`, new Date(base + i * 1000))

    const first = await page('alpha', task.id, '?limit=3')
    expect(first.messages.map((m) => m.body)).toEqual(['#6', '#5', '#4'])
    expect(first.nextBefore).not.toBeNull()
    const second = await page('alpha', task.id, `?limit=3&before=${encodeURIComponent(first.nextBefore!)}`)
    expect(second.messages.map((m) => m.body)).toEqual(['#3', '#2', '#1'])
    const third = await page('alpha', task.id, `?limit=3&before=${encodeURIComponent(second.nextBefore!)}`)
    expect(third.messages.map((m) => m.body)).toEqual(['#0'])
    expect(third.nextBefore).toBeNull()

    const all = await page('alpha', task.id)
    expect(all.messages).toHaveLength(7)
    expect(all.nextBefore).toBeNull()
  })

  it('never splits messages with the same timestamp across pages', async () => {
    const task = await createTask('alpha', ids.alpha)
    const base = Date.now() - 60 * MINUTE
    await insertMessage(task.id, 'alpha', 't1', new Date(base))
    await insertMessage(task.id, 'alpha', 't2a', new Date(base + 1000))
    await insertMessage(task.id, 'alpha', 't2b', new Date(base + 1000))
    await insertMessage(task.id, 'alpha', 't3', new Date(base + 2000))

    const seen: string[] = []
    let before: string | null = null
    do {
      const query: string = `?limit=2${before ? `&before=${encodeURIComponent(before)}` : ''}`
      const result = await page('alpha', task.id, query)
      expect(result.messages.length).toBeGreaterThan(0)
      seen.push(...result.messages.map((m) => m.body))
      before = result.nextBefore
    } while (before)
    expect(seen.sort()).toEqual(['t1', 't2a', 't2b', 't3'])
  })

  describe('edit and delete', () => {
    it('lets the author edit within 15 minutes', async () => {
      const message = await post('alpha', 'general', 'Опечатка')
      const response = await call('alpha', 'PATCH', `/api/messages/${message.id}`, { body: 'Исправлено' })
      expect(response.statusCode, response.body).toBe(200)
      expect(response.json<MessageDto>()).toMatchObject({ id: message.id, body: 'Исправлено', deleted: false })
      expect(response.json<MessageDto>().editedAt).not.toBeNull()

      const other = await call('beta', 'PATCH', `/api/messages/${message.id}`, { body: 'Чужое' })
      expect(other.statusCode).toBe(403)
      expect(other.json()).toMatchObject({ error: 'forbidden' })
      expect((await call('beta', 'DELETE', `/api/messages/${message.id}`)).statusCode).toBe(403)
    })

    it('freezes messages older than 15 minutes', async () => {
      const old = await insertMessage(null, 'alpha', 'Давнее', new Date(Date.now() - 16 * MINUTE))
      expect((await call('alpha', 'PATCH', `/api/messages/${old.id}`, { body: 'Новое' })).statusCode).toBe(403)
      expect((await call('alpha', 'DELETE', `/api/messages/${old.id}`)).statusCode).toBe(403)

      const recent = await insertMessage(null, 'alpha', 'Недавнее', new Date(Date.now() - 14 * MINUTE))
      expect((await call('alpha', 'PATCH', `/api/messages/${recent.id}`, { body: 'Поправил' })).statusCode).toBe(200)
    })

    it('keeps deleted messages in history without their text', async () => {
      const message = await post('alpha', 'general', 'Удалю')
      expect((await call('alpha', 'DELETE', `/api/messages/${message.id}`)).statusCode).toBe(204)
      const listed = (await page('beta', 'general')).messages.find((m) => m.id === message.id)
      expect(listed).toMatchObject({ deleted: true, body: '', mentions: [] })
      expect((await call('alpha', 'PATCH', `/api/messages/${message.id}`, { body: 'Верну' })).statusCode).toBe(403)
      expect((await call('alpha', 'DELETE', `/api/messages/${message.id}`)).statusCode).toBe(403)
    })

    it('answers 404 for unknown messages', async () => {
      expect((await call('alpha', 'PATCH', `/api/messages/${randomUUID()}`, { body: 'x' })).statusCode).toBe(404)
      expect((await call('alpha', 'DELETE', '/api/messages/nonsense')).statusCode).toBe(404)
    })
  })

  it('makes a done task chat read-only', async () => {
    const task = await createTask('alpha', ids.beta)
    const message = await post('beta', task.id, 'Готово')
    const done = await call('alpha', 'POST', `/api/tasks/${task.id}/transition`, { to: 'done' })
    expect(done.statusCode, done.body).toBe(200)

    const response = await call('beta', 'POST', `/api/chats/${task.id}/messages`, { body: 'Ещё' })
    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({ error: 'forbidden' })
    expect((await call('owner', 'POST', `/api/chats/${task.id}/messages`, { body: 'Ещё' })).statusCode).toBe(403)
    expect((await call('beta', 'PATCH', `/api/messages/${message.id}`, { body: 'Правка' })).statusCode).toBe(403)
    expect((await page('beta', task.id)).messages.map((m) => m.id)).toEqual([message.id])
    expect((await call('beta', 'POST', `/api/chats/${task.id}/read`)).statusCode).toBe(204)
  })

  it('keeps mentions of active users who can see the chat', async () => {
    const message = await post('alpha', shared.id, '@Beta и @gamma, @owner. и @zeta, почта a@beta.ru, @nobody')
    expect(message.mentions).toEqual([ids.beta, ids.owner])
    const listed = (await page('beta', shared.id)).messages.find((m) => m.id === message.id)
    expect(listed?.mentions).toEqual([ids.beta, ids.owner])

    expect((await post('alpha', 'general', '@gamma глянь')).mentions).toEqual([ids.gamma])
    const edited = await call('alpha', 'PATCH', `/api/messages/${message.id}`, { body: 'без упоминаний' })
    expect(edited.json<MessageDto>().mentions).toEqual([])
  })

  it('counts unread messages from others and marks chats read', async () => {
    expect((await call('eps', 'POST', '/api/chats/general/read')).statusCode).toBe(204)
    expect((await unread('eps')).general).toBe(0)

    await post('kappa', 'general', 'раз')
    await post('kappa', 'general', 'два')
    await post('eps', 'general', 'своё не считается')
    expect((await unread('eps')).general).toBe(2)

    const task = await createTask('kappa', ids.eps)
    await post('kappa', task.id, 'один')
    const second = await post('kappa', task.id, 'два')
    await post('kappa', task.id, 'три')
    await post('eps', task.id, 'ответ')
    expect((await unread('eps')).tasks[task.id]).toBe(3)
    expect((await unread('kappa')).tasks[task.id]).toBe(1)
    expect((await unread('gamma')).tasks[task.id]).toBeUndefined()
    // The owner sees every task, so its chats count too.
    expect((await unread('owner')).tasks[task.id]).toBe(4)

    expect((await call('kappa', 'DELETE', `/api/messages/${second.id}`)).statusCode).toBe(204)
    expect((await unread('eps')).tasks[task.id]).toBe(2)

    expect((await call('eps', 'POST', `/api/chats/${task.id}/read`)).statusCode).toBe(204)
    expect((await call('eps', 'POST', '/api/chats/general/read')).statusCode).toBe(204)
    const after = await unread('eps')
    expect(after.general).toBe(0)
    expect(after.tasks[task.id]).toBeUndefined()

    await post('kappa', task.id, 'новое')
    expect((await unread('eps')).tasks[task.id]).toBe(1)
  })

  describe('websocket', () => {
    let base: string

    beforeAll(async () => {
      await app.listen({ port: 0, host: '127.0.0.1' })
      base = `ws://127.0.0.1:${(app.server.address() as AddressInfo).port}/api/ws`
    })

    /** Opens a socket for `who` and buffers its frames from the first moment. */
    async function connect(who: Who) {
      const socket = new WebSocket(base, { headers: { cookie: `cc_session=${tokens[who]}` } })
      const frames: WsEvent[] = []
      const waiters: ((event: WsEvent) => void)[] = []
      socket.on('message', (data) => {
        const event = JSON.parse(data.toString()) as WsEvent
        const waiter = waiters.shift()
        if (waiter) waiter(event)
        else frames.push(event)
      })
      await new Promise<void>((resolve, reject) => {
        socket.once('open', () => resolve())
        socket.once('error', reject)
      })
      const next = () =>
        new Promise<WsEvent>((resolve, reject) => {
          const queued = frames.shift()
          if (queued) return resolve(queued)
          const timer = setTimeout(() => reject(new Error(`no frame for ${who}`)), 5000)
          waiters.push((event) => {
            clearTimeout(timer)
            resolve(event)
          })
        })
      return { socket, next }
    }

    it('refuses the upgrade without a session', async () => {
      const socket = new WebSocket(base)
      const status = await new Promise<number>((resolve, reject) => {
        socket.once('unexpected-response', (request, response) => {
          resolve(response.statusCode ?? 0)
          // With this listener set, ws leaves the refused handshake to us.
          request.destroy()
        })
        socket.once('error', () => {})
        socket.once('open', () => reject(new Error('opened without a session')))
      })
      expect(status).toBe(401)
    })

    it('pushes events only to users who can see the chat', async () => {
      const beta = await connect('beta')
      const gamma = await connect('gamma')
      try {
        // Beta can't see the private task, gamma can't see the shared one: their first frames are the visible posts.
        await post('alpha', privateTask.id, 'не для беты')
        const forBeta = await post('alpha', shared.id, 'для беты')
        const forAll = await post('alpha', 'general', 'для всех')

        expect(await beta.next()).toEqual({ type: 'message.created', message: forBeta })
        expect(await beta.next()).toEqual({ type: 'message.created', message: forAll })
        expect(await gamma.next()).toEqual({ type: 'message.created', message: forAll })

        const edited = await call('alpha', 'PATCH', `/api/messages/${forBeta.id}`, { body: 'для беты, исправлено' })
        expect(await beta.next()).toEqual({ type: 'message.updated', message: edited.json<MessageDto>() })

        await call('alpha', 'DELETE', `/api/messages/${forAll.id}`)
        expect(await gamma.next()).toMatchObject({ type: 'message.deleted', message: { id: forAll.id, deleted: true, body: '' } })
        expect((await beta.next()).type).toBe('message.deleted')

        await call('beta', 'POST', `/api/chats/${shared.id}/read`)
        expect(await beta.next()).toEqual({ type: 'chat.read', chatKey: shared.id, userId: ids.beta })
      } finally {
        beta.socket.close()
        gamma.socket.close()
      }
    })
  })
})
