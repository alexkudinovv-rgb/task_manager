import { randomUUID } from 'node:crypto'
import { count, eq } from 'drizzle-orm'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, runMigrations, type DbHandle } from './client'
import { DEFAULT_EVENT_MODES, STARTER_POSITIONS, STARTER_UNITS, seedReferenceData } from './reference-data'
import {
  attachments,
  checklistItems,
  dueChangeRequests,
  messages,
  notificationDefaults,
  positions,
  sessions,
  taskCoexecutors,
  taskEvents,
  tasks,
  units,
  users,
  type NewTask,
  type NewUser,
} from './schema'

const DATABASE_URL = process.env.DATABASE_URL

/** Postgres SQLSTATE of a rejected query (drizzle wraps the pg error in `cause`). */
async function pgCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise
  } catch (error) {
    const e = error as { code?: string; cause?: { code?: string } }
    return e.cause?.code ?? e.code
  }
  return undefined
}

const UNIQUE = '23505'
const CHECK = '23514'
const FK = '23503'

describe.skipIf(!DATABASE_URL)('database schema (real Postgres)', () => {
  // Each run migrates a fresh throwaway database, so the dev DB is never touched.
  const dbName = `tasks_test_${randomUUID().replaceAll('-', '').slice(0, 12)}`
  let admin: pg.Client
  let handle: DbHandle

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: DATABASE_URL })
    await admin.connect()
    await admin.query(`CREATE DATABASE ${dbName}`)
    const url = new URL(DATABASE_URL!)
    url.pathname = `/${dbName}`
    handle = createDb(url.toString(), { max: 4 })
    await runMigrations(handle.db)
  }, 60_000)

  afterAll(async () => {
    // Expected during teardown: DROP ... WITH (FORCE) may kill clients that are still closing.
    handle?.pool.on('error', () => {})
    await handle?.close()
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`)
      await admin.end()
    }
  }, 60_000)

  let n = 0
  async function makeUser(overrides: Partial<NewUser> = {}) {
    n += 1
    const [row] = await handle.db
      .insert(users)
      .values({ login: `user${n}`, firstName: 'Имя', lastName: 'Фамилия', ...overrides })
      .returning()
    return row!
  }

  async function makeTask(authorId: string, responsibleId: string, overrides: Partial<NewTask> = {}) {
    const [row] = await handle.db
      .insert(tasks)
      .values({ title: 'Задача', authorId, responsibleId, dueDate: '2026-11-01', ...overrides })
      .returning()
    return row!
  }

  it('seeds reference data idempotently', async () => {
    const first = await seedReferenceData(handle.db)
    const second = await seedReferenceData(handle.db)
    expect(first.positions).toBe(STARTER_POSITIONS.length)
    expect(first.units).toBe(STARTER_UNITS.length)
    expect(first.notificationDefaults).toBe(Object.keys(DEFAULT_EVENT_MODES).length * 3)
    expect(second).toEqual({ positions: 0, units: 0, notificationDefaults: 0 })

    const [p] = await handle.db.select({ c: count() }).from(positions)
    const [u] = await handle.db.select({ c: count() }).from(units)
    expect(p!.c).toBe(STARTER_POSITIONS.length)
    expect(u!.c).toBe(STARTER_UNITS.length)

    const telegram = await handle.db
      .select()
      .from(notificationDefaults)
      .where(eq(notificationDefaults.channel, 'telegram'))
    expect(telegram.every((r) => r.mode === 'off')).toBe(true)
  })

  it('allows only one owner, and the owner must be an admin', async () => {
    expect(await pgCode(makeUser({ role: 'owner', isAdmin: false }))).toBe(CHECK)
    await makeUser({ role: 'owner', isAdmin: true })
    expect(await pgCode(makeUser({ role: 'owner', isAdmin: true }))).toBe(UNIQUE)
  })

  it('stores logins lowercased and unique', async () => {
    expect(await pgCode(makeUser({ login: 'Ivanov' }))).toBe(CHECK)
    await makeUser({ login: 'ivanov' })
    expect(await pgCode(makeUser({ login: 'ivanov' }))).toBe(UNIQUE)
  })

  it('allows at most one not-done hot task per responsible', async () => {
    const author = await makeUser()
    const a = await makeUser()
    const b = await makeUser()

    const hot = await makeTask(author.id, a.id, { priority: 'hot' })
    expect(await pgCode(makeTask(author.id, a.id, { priority: 'hot' }))).toBe(UNIQUE)

    // Raising an existing task to hot is caught too.
    const other = await makeTask(author.id, a.id, { priority: 'high' })
    expect(
      await pgCode(handle.db.update(tasks).set({ priority: 'hot' }).where(eq(tasks.id, other.id))),
    ).toBe(UNIQUE)

    // Another person can have their own hot task.
    await makeTask(author.id, b.id, { priority: 'hot' })

    // Once the first one is done, a new hot task is allowed.
    await handle.db
      .update(tasks)
      .set({ status: 'done', completedAt: new Date() })
      .where(eq(tasks.id, hot.id))
    await makeTask(author.id, a.id, { priority: 'hot' })
  })

  it('allows cancelled only on done tasks, and completed_at only when done', async () => {
    const u = await makeUser()
    expect(await pgCode(makeTask(u.id, u.id, { cancelled: true }))).toBe(CHECK)
    expect(await pgCode(makeTask(u.id, u.id, { status: 'in_progress', cancelled: true }))).toBe(CHECK)
    expect(await pgCode(makeTask(u.id, u.id, { status: 'done' }))).toBe(CHECK)
    expect(await pgCode(makeTask(u.id, u.id, { completedAt: new Date() }))).toBe(CHECK)

    const t = await makeTask(u.id, u.id, { status: 'done', cancelled: true, completedAt: new Date() })
    expect(t.cancelled).toBe(true)
    expect(t.dueDate).toBe('2026-11-01')
    expect(t.dueTime).toBeNull()
  })

  it('keeps one pending due-change request per task with a consistent decision', async () => {
    const u = await makeUser()
    const t = await makeTask(u.id, u.id)
    const req = { taskId: t.id, requestedBy: u.id, newDueDate: '2026-12-01', reason: 'нужно больше времени' }
    const [first] = await handle.db.insert(dueChangeRequests).values(req).returning()
    expect(await pgCode(handle.db.insert(dueChangeRequests).values(req))).toBe(UNIQUE)

    // Deciding without decided_by/decided_at is rejected.
    expect(
      await pgCode(
        handle.db.update(dueChangeRequests).set({ state: 'approved' }).where(eq(dueChangeRequests.id, first!.id)),
      ),
    ).toBe(CHECK)
    await handle.db
      .update(dueChangeRequests)
      .set({ state: 'rejected', decidedBy: u.id, decidedAt: new Date() })
      .where(eq(dueChangeRequests.id, first!.id))
    await handle.db.insert(dueChangeRequests).values(req)
  })

  it('requires an attachment to belong to exactly one of task or message', async () => {
    const u = await makeUser()
    const t = await makeTask(u.id, u.id)
    const [m] = await handle.db.insert(messages).values({ taskId: t.id, authorId: u.id, body: 'файл' }).returning()
    const file = (key: string) => ({ storageKey: key, fileName: 'a.pdf', sizeBytes: 10, mime: 'application/pdf', uploadedBy: u.id })

    expect(await pgCode(handle.db.insert(attachments).values(file('k1')))).toBe(CHECK)
    expect(
      await pgCode(handle.db.insert(attachments).values({ ...file('k2'), taskId: t.id, messageId: m!.id })),
    ).toBe(CHECK)
    await handle.db.insert(attachments).values({ ...file('k3'), taskId: t.id })
    await handle.db.insert(attachments).values({ ...file('k4'), messageId: m!.id })
  })

  it('cascades task children, restricts deleting authors, cascades user-owned rows', async () => {
    const author = await makeUser()
    const resp = await makeUser()
    const parent = await makeTask(author.id, resp.id)
    const sub = await makeTask(resp.id, resp.id, { parentId: parent.id })
    await handle.db.insert(taskCoexecutors).values({ taskId: parent.id, userId: author.id })
    await handle.db.insert(checklistItems).values({ taskId: parent.id, text: 'пункт' })
    await handle.db.insert(taskEvents).values({ taskId: parent.id, actorId: author.id, type: 'created' })
    await handle.db.insert(taskEvents).values({ taskId: parent.id, actorId: null, type: 'overdue' })
    const [m] = await handle.db.insert(messages).values({ taskId: parent.id, authorId: resp.id, body: 'привет' }).returning()
    await handle.db.insert(attachments).values({
      messageId: m!.id, storageKey: `k-${parent.id}`, fileName: 'x.png', sizeBytes: 1, mime: 'image/png', uploadedBy: resp.id,
    })

    // Users with authored tasks cannot be hard-deleted (they get disabled_at instead).
    expect(await pgCode(handle.db.delete(users).where(eq(users.id, author.id)))).toBe(FK)
    // A task cannot be its own parent.
    expect(await pgCode(handle.db.update(tasks).set({ parentId: parent.id }).where(eq(tasks.id, parent.id)))).toBe(CHECK)

    await handle.db.delete(tasks).where(eq(tasks.id, parent.id))
    expect(await handle.db.select().from(tasks).where(eq(tasks.id, sub.id))).toHaveLength(0)
    expect(await handle.db.select().from(taskCoexecutors).where(eq(taskCoexecutors.taskId, parent.id))).toHaveLength(0)
    expect(await handle.db.select().from(checklistItems).where(eq(checklistItems.taskId, parent.id))).toHaveLength(0)
    expect(await handle.db.select().from(taskEvents).where(eq(taskEvents.taskId, parent.id))).toHaveLength(0)
    expect(await handle.db.select().from(messages).where(eq(messages.id, m!.id))).toHaveLength(0)
    expect(await handle.db.select().from(attachments).where(eq(attachments.messageId, m!.id))).toHaveLength(0)

    // A user without authored rows can be deleted; their sessions go with them.
    const temp = await makeUser()
    await handle.db.insert(sessions).values({
      userId: temp.id, tokenHash: `h-${temp.id}`, expiresAt: new Date(Date.now() + 86_400_000), ip: '127.0.0.1',
    })
    await handle.db.delete(users).where(eq(users.id, temp.id))
    expect(await handle.db.select().from(sessions).where(eq(sessions.userId, temp.id))).toHaveLength(0)
  })
})
