import { randomBytes } from 'node:crypto'
import type { DueRequestDto, Task, TaskDetailsDto, WorkspaceDto } from '@car-city/shared/model'
import { and, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../app'
import { hashToken } from '../../auth'
import { loadConfig } from '../../config'
import { attachments, messages, notifications, sessions, taskEvents, users } from '../../db/schema'
import { createTestDb, TEST_DATABASE_URL, type TestDb } from '../../test/test-db'

type Who = 'owner' | 'alpha' | 'beta' | 'gamma' | 'delta'
type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'

// Each test makes a dozen HTTP calls against Postgres; the default 5 s is tight on a busy machine.
describe.skipIf(!TEST_DATABASE_URL)('tasks API', { timeout: 20_000 }, () => {
  let testDb: TestDb
  let app: FastifyInstance
  const ids = {} as Record<Who, string>
  const tokens = {} as Record<Who, string>

  beforeAll(async () => {
    testDb = await createTestDb()
    app = buildApp(loadConfig({ NODE_ENV: 'test' }), { db: testDb.db })
    await app.ready()
    const people: [Who, 'owner' | 'director'][] = [
      ['owner', 'owner'],
      ['alpha', 'director'],
      ['beta', 'director'],
      ['gamma', 'director'],
      ['delta', 'director'],
    ]
    for (const [who, role] of people) {
      const [user] = await testDb.db
        .insert(users)
        .values({ login: who, firstName: who, lastName: 'Тестов', role, isAdmin: role === 'owner', passwordHash: 'x' })
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
    // pool.end() resolves before sockets close, so DROP ... WITH (FORCE) may kill a closing client (57P01).
    testDb?.pool.on('error', () => {})
    await testDb?.drop()
  }, 60_000)

  const call = (who: Who | null, method: Method, url: string, payload?: object) =>
    app.inject({ method, url, payload, cookies: who ? { cc_session: tokens[who] } : {} })

  async function create(who: Who, body: Record<string, unknown>): Promise<Task> {
    const response = await call(who, 'POST', '/api/tasks', { title: 'Задача', dueDate: '2026-11-20', ...body })
    expect(response.statusCode, response.body).toBe(201)
    return response.json<Task>()
  }

  async function workspaceIds(who: Who): Promise<string[]> {
    const response = await call(who, 'GET', '/api/workspace')
    expect(response.statusCode).toBe(200)
    return response.json<WorkspaceDto>().tasks.map((t) => t.id)
  }

  async function workspaceTask(who: Who, id: string): Promise<Task> {
    const response = await call(who, 'GET', '/api/workspace')
    return response.json<WorkspaceDto>().tasks.find((t) => t.id === id)!
  }

  const transition = (who: Who, id: string, body: object) => call(who, 'POST', `/api/tasks/${id}/transition`, body)

  const eventsOf = (taskId: string) => testDb.db.select().from(taskEvents).where(eq(taskEvents.taskId, taskId))
  const ownerNotices = (taskId: string) =>
    testDb.db.select().from(notifications).where(and(eq(notifications.taskId, taskId), eq(notifications.userId, ids.owner)))

  it('requires a session', async () => {
    expect((await call(null, 'GET', '/api/workspace')).statusCode).toBe(401)
    const response = await call(null, 'POST', '/api/tasks', { title: 'x', responsibleId: ids.alpha, dueDate: '2026-11-20' })
    expect(response.statusCode).toBe(401)
    expect(response.json()).toMatchObject({ error: 'unauthorized' })
  })

  it('returns the directory and me in the workspace', async () => {
    const response = await call('alpha', 'GET', '/api/workspace')
    const body = response.json<WorkspaceDto>()
    expect(body.me).toMatchObject({ id: ids.alpha, login: 'alpha', role: 'director', disabled: false })
    expect(body.users).toHaveLength(5)
    expect(body.positions.length).toBeGreaterThan(0)
    expect(body.units.length).toBeGreaterThan(0)
  })

  describe('visibility', () => {
    let shared: Task
    let sub: Task
    let privateTask: Task
    let ownerTask: Task

    beforeAll(async () => {
      shared = await create('alpha', { responsibleId: ids.beta })
      sub = await create('beta', { responsibleId: ids.gamma, parentId: shared.id })
      privateTask = await create('alpha', { responsibleId: ids.alpha })
      ownerTask = await create('owner', { responsibleId: ids.delta })
    })

    it('shows each viewer exactly what canSee allows', async () => {
      const all = [shared.id, sub.id, privateTask.id, ownerTask.id]
      const seen = async (who: Who) => (await workspaceIds(who)).filter((id) => all.includes(id)).sort()
      expect(await seen('owner')).toEqual([...all].sort())
      expect(await seen('alpha')).toEqual([shared.id, sub.id, privateTask.id].sort())
      expect(await seen('beta')).toEqual([shared.id, sub.id].sort())
      // Subtask participant sees the parent too.
      expect(await seen('gamma')).toEqual([shared.id, sub.id].sort())
      expect(await seen('delta')).toEqual([ownerTask.id])
    })

    it('answers 404 for tasks the viewer cannot see, on every task route', async () => {
      for (const [method, url, body] of [
        ['GET', `/api/tasks/${shared.id}`, undefined],
        ['PATCH', `/api/tasks/${shared.id}`, { title: 'чужое' }],
        ['POST', `/api/tasks/${shared.id}/transition`, { to: 'in_progress' }],
        ['PUT', `/api/tasks/${shared.id}/coexecutors`, { userIds: [] }],
        ['POST', `/api/tasks/${shared.id}/checklist`, { text: 'пункт' }],
        ['POST', `/api/tasks/${shared.id}/due-requests`, { dueDate: '2026-12-01', reason: 'нужно' }],
        ['POST', '/api/tasks', { title: 'под', responsibleId: ids.delta, dueDate: '2026-11-20', parentId: shared.id }],
      ] as const) {
        const response = await call('delta', method, url, body)
        expect(response.statusCode, `${method} ${url}`).toBe(404)
        expect(response.json()).toMatchObject({ error: 'not_found' })
      }
      expect((await call('alpha', 'GET', '/api/tasks/not-a-uuid')).statusCode).toBe(404)
      expect((await call('alpha', 'GET', `/api/tasks/${ownerTask.id}`)).statusCode).toBe(404)
    })

    it('returns details with parent, visible subtasks and allowed actions', async () => {
      const parent = (await call('gamma', 'GET', `/api/tasks/${shared.id}`)).json<TaskDetailsDto>()
      expect(parent.task.id).toBe(shared.id)
      expect(parent.subtasks.map((s) => s.id)).toEqual([sub.id])
      expect(parent.allowedActions).toMatchObject({ complete: false, edit: false, comment: true })

      const child = (await call('gamma', 'GET', `/api/tasks/${sub.id}`)).json<TaskDetailsDto>()
      expect(child.parent?.id).toBe(shared.id)
      expect(child.allowedActions).toMatchObject({ start: true, complete: true, addSubtask: false })

      const asResponsible = (await call('beta', 'GET', `/api/tasks/${shared.id}`)).json<TaskDetailsDto>()
      expect(asResponsible.allowedActions).toMatchObject({ complete: true, edit: false, addSubtask: true, requestDueChange: true })
      expect(asResponsible.events.map((e) => e.type)).toEqual(['task_created'])
    })
  })

  describe('creating', () => {
    it('lets a director assign anyone but the owner', async () => {
      const response = await call('alpha', 'POST', '/api/tasks', { title: 'Шефу', responsibleId: ids.owner, dueDate: '2026-11-20' })
      expect(response.statusCode).toBe(403)
      expect(response.json()).toMatchObject({ error: 'forbidden' })
      const own = await create('alpha', { responsibleId: ids.alpha, dueTime: '15:30', startDate: '2026-11-01' })
      expect(own).toMatchObject({ authorId: ids.alpha, status: 'new', priority: 'medium', dueTime: '15:30', startDate: '2026-11-01' })
      await create('owner', { responsibleId: ids.owner })
    })

    it('validates the responsible and coexecutors', async () => {
      const unknown = await call('alpha', 'POST', '/api/tasks', { title: 'x', responsibleId: 'nobody', dueDate: '2026-11-20' })
      expect(unknown.statusCode).toBe(400)
      const self = await call('alpha', 'POST', '/api/tasks', {
        title: 'x', responsibleId: ids.beta, coexecutorIds: [ids.beta], dueDate: '2026-11-20',
      })
      expect(self.statusCode).toBe(400)
      const ghost = await call('alpha', 'POST', '/api/tasks', {
        title: 'x', responsibleId: ids.beta, coexecutorIds: ['00000000-0000-4000-8000-000000000000'], dueDate: '2026-11-20',
      })
      expect(ghost.statusCode).toBe(400)
      const bad = await call('alpha', 'POST', '/api/tasks', { title: '', responsibleId: ids.beta, dueDate: '2026-13-01' })
      expect(bad.statusCode).toBe(400)
      expect(bad.json()).toMatchObject({ error: 'validation' })
    })

    it('creates subtasks by the responsible, one level deep, not under a done task', async () => {
      const parent = await create('alpha', { responsibleId: ids.beta, coexecutorIds: [ids.gamma] })
      const sub = await create('beta', { responsibleId: ids.delta, parentId: parent.id })
      expect(sub).toMatchObject({ parentId: parent.id, authorId: ids.beta, responsibleId: ids.delta })

      // A coexecutor of the parent cannot add subtasks.
      const byCoexecutor = await call('gamma', 'POST', '/api/tasks', {
        title: 'под', responsibleId: ids.gamma, dueDate: '2026-11-20', parentId: parent.id,
      })
      expect(byCoexecutor.statusCode).toBe(403)

      const nested = await call('delta', 'POST', '/api/tasks', {
        title: 'под-под', responsibleId: ids.delta, dueDate: '2026-11-20', parentId: sub.id,
      })
      expect(nested.statusCode).toBe(400)

      // Nobody assigns a subtask to the owner unless they are the owner.
      const toOwner = await call('beta', 'POST', '/api/tasks', {
        title: 'под', responsibleId: ids.owner, dueDate: '2026-11-20', parentId: parent.id,
      })
      expect(toOwner.statusCode).toBe(403)

      expect((await transition('beta', parent.id, { to: 'done' })).statusCode).toBe(200)
      const underDone = await call('beta', 'POST', '/api/tasks', {
        title: 'под', responsibleId: ids.beta, dueDate: '2026-11-20', parentId: parent.id,
      })
      expect(underDone.statusCode).toBe(400)
    })

    it('lets only the owner set hot', async () => {
      const response = await call('alpha', 'POST', '/api/tasks', {
        title: 'Горит', responsibleId: ids.alpha, dueDate: '2026-11-20', priority: 'hot',
      })
      expect(response.statusCode).toBe(403)
    })
  })

  describe('hot limit', () => {
    it('keeps one open hot task per responsible', async () => {
      const first = await create('owner', { responsibleId: ids.beta, priority: 'hot' })
      expect(first.priority).toBe('hot')
      expect((await eventsOf(first.id)).map((e) => e.type).sort()).toEqual(['hot_set', 'task_created'])

      const second = await call('owner', 'POST', '/api/tasks', {
        title: 'Ещё', responsibleId: ids.beta, dueDate: '2026-11-20', priority: 'hot',
      })
      expect(second.statusCode).toBe(409)
      expect(second.json()).toMatchObject({ error: 'hot_limit', conflictingTaskId: first.id })

      const plain = await create('owner', { responsibleId: ids.beta })
      const raise = await call('owner', 'PATCH', `/api/tasks/${plain.id}`, { priority: 'hot' })
      expect(raise.statusCode).toBe(409)
      expect(raise.json()).toMatchObject({ error: 'hot_limit', conflictingTaskId: first.id })

      // After the first one is done, a new hot task is fine.
      expect((await transition('beta', first.id, { to: 'done' })).statusCode).toBe(200)
      const next = await create('owner', { responsibleId: ids.beta, priority: 'hot' })

      // Reopening the old hot task would make two.
      const reopen = await transition('owner', first.id, { to: 'in_progress', comment: 'доделать' })
      expect(reopen.statusCode).toBe(409)
      expect(reopen.json()).toMatchObject({ error: 'hot_limit', conflictingTaskId: next.id })
    })

    it('turns a concurrent duplicate into 409 via the unique index', async () => {
      const body = { title: 'Гонка', responsibleId: ids.delta, dueDate: '2026-11-20', priority: 'hot' }
      const responses = await Promise.all([1, 2, 3].map(() => call('owner', 'POST', '/api/tasks', body)))
      const codes = responses.map((r) => r.statusCode).sort()
      expect(codes).toEqual([201, 409, 409])
      const winner = responses.find((r) => r.statusCode === 201)!.json<Task>()
      for (const loser of responses.filter((r) => r.statusCode === 409)) {
        expect(loser.json()).toMatchObject({ error: 'hot_limit', conflictingTaskId: winner.id })
      }
    })

    it('freezes hot priority and due date for everyone but the owner', async () => {
      const task = await create('alpha', { responsibleId: ids.alpha })
      expect((await call('owner', 'PATCH', `/api/tasks/${task.id}`, { priority: 'hot' })).statusCode).toBe(200)
      expect((await call('alpha', 'PATCH', `/api/tasks/${task.id}`, { dueDate: '2026-12-31' })).statusCode).toBe(403)
      expect((await call('alpha', 'PATCH', `/api/tasks/${task.id}`, { priority: 'low' })).statusCode).toBe(403)
      // Title is still the author's to edit.
      expect((await call('alpha', 'PATCH', `/api/tasks/${task.id}`, { title: 'Новое имя' })).statusCode).toBe(200)
      const hotNotices = (await ownerNotices(task.id)).filter((n) => n.event === 'hot_set')
      expect(hotNotices).toHaveLength(0)
    })
  })

  describe('transitions', () => {
    it('runs the lifecycle with document, cancel and reopen rules', async () => {
      const task = await create('alpha', { responsibleId: ids.beta, coexecutorIds: [ids.gamma], requiresDocument: true })

      expect((await transition('gamma', task.id, { to: 'in_progress' })).statusCode).toBe(403)
      const started = await transition('beta', task.id, { to: 'in_progress' })
      expect(started.json<Task>().status).toBe('in_progress')
      expect((await transition('beta', task.id, { to: 'new' })).json()).toMatchObject({ error: 'invalid_transition' })

      const coexecutorDone = await transition('gamma', task.id, { to: 'done' })
      expect(coexecutorDone.statusCode).toBe(403)
      const withoutDocument = await transition('beta', task.id, { to: 'done' })
      expect(withoutDocument.statusCode).toBe(400)
      expect(withoutDocument.json()).toMatchObject({ error: 'document_required' })

      await testDb.db.insert(attachments).values({
        taskId: task.id, storageKey: `doc-${task.id}`, fileName: 'акт.pdf', sizeBytes: 10, mime: 'application/pdf', uploadedBy: ids.beta,
      })
      const done = (await transition('beta', task.id, { to: 'done' })).json<Task>()
      expect(done).toMatchObject({ status: 'done', cancelled: false, attachmentCount: 1 })
      expect(done.completedAt).not.toBeNull()

      expect((await transition('beta', task.id, { to: 'in_progress', comment: 'ещё' })).statusCode).toBe(403)
      const noComment = await transition('alpha', task.id, { to: 'in_progress', comment: '  ' })
      expect(noComment.json()).toMatchObject({ error: 'comment_required' })
      const reopened = (await transition('alpha', task.id, { to: 'in_progress', comment: 'Переделать акт' })).json<Task>()
      expect(reopened).toMatchObject({ status: 'in_progress', completedAt: null, cancelled: false })

      expect((await transition('alpha', task.id, { to: 'done', cancelled: true })).json()).toMatchObject({ error: 'comment_required' })
      expect((await transition('beta', task.id, { to: 'done', cancelled: true, comment: 'не нужно' })).statusCode).toBe(403)
      const cancelled = (await transition('alpha', task.id, { to: 'done', cancelled: true, comment: 'Уже не нужно' })).json<Task>()
      expect(cancelled).toMatchObject({ status: 'done', cancelled: true })
      expect(cancelled.completedAt).not.toBeNull()
      expect((await transition('alpha', task.id, { to: 'done', cancelled: true, comment: 'ещё раз' })).statusCode).toBe(400)

      const details = (await call('alpha', 'GET', `/api/tasks/${task.id}`)).json<TaskDetailsDto>()
      expect(details.events.map((e) => e.type)).toEqual([
        'task_cancelled', 'task_reopened', 'task_completed', 'task_started', 'task_created',
      ])
      expect(details.events[1]!.payload).toMatchObject({ from: 'done', to: 'in_progress', comment: 'Переделать акт' })
      expect(details.events[0]!.actorId).toBe(ids.alpha)
      expect(details.allowedActions).toMatchObject({ reopen: true, edit: false, complete: false })

      // Reopen notifies the owner at once; completion and cancel go to the digest; start is silent.
      const notices = await ownerNotices(task.id)
      const byEvent = Object.fromEntries(notices.map((n) => [n.event, n]))
      expect(Object.keys(byEvent).sort()).toEqual(['task_cancelled', 'task_completed', 'task_created', 'task_reopened'])
      expect(byEvent.task_reopened!.payload).toMatchObject({ mode: 'immediate', taskTitle: 'Задача', actorId: ids.alpha })
      expect(byEvent.task_completed!.payload).toMatchObject({ mode: 'digest', actorId: ids.beta })
      expect(byEvent.task_reopened!.dedupeKey).toBe(`task_reopened:${byEvent.task_reopened!.payload.eventId}`)
    })

    it('writes no owner notifications for the owner\'s own actions', async () => {
      const task = await create('owner', { responsibleId: ids.owner })
      await transition('owner', task.id, { to: 'done' })
      await transition('owner', task.id, { to: 'in_progress', comment: 'снова' })
      await call('owner', 'PATCH', `/api/tasks/${task.id}`, { dueDate: '2026-12-01' })
      expect(await ownerNotices(task.id)).toHaveLength(0)
      expect((await eventsOf(task.id)).map((e) => e.type).sort()).toEqual([
        'due_changed', 'task_completed', 'task_created', 'task_reopened',
      ])
    })
  })

  describe('editing', () => {
    it('gates each field and records the changes', async () => {
      const task = await create('alpha', { responsibleId: ids.beta })
      expect((await call('beta', 'PATCH', `/api/tasks/${task.id}`, { title: 'Моё' })).statusCode).toBe(403)
      // Sending unchanged values is not an edit.
      expect((await call('beta', 'PATCH', `/api/tasks/${task.id}`, { title: task.title })).statusCode).toBe(200)
      expect((await call('alpha', 'PATCH', `/api/tasks/${task.id}`, { responsibleId: ids.owner })).statusCode).toBe(403)

      const updated = await call('alpha', 'PATCH', `/api/tasks/${task.id}`, {
        title: 'Новое', dueDate: '2026-11-25', dueTime: '10:00', priority: 'high',
      })
      expect(updated.statusCode).toBe(200)
      expect(updated.json<Task>()).toMatchObject({ title: 'Новое', dueDate: '2026-11-25', dueTime: '10:00', priority: 'high' })

      const events = await eventsOf(task.id)
      const due = events.find((e) => e.type === 'due_changed')!
      expect(due.payload).toEqual({
        from: { dueDate: '2026-11-20', dueTime: null },
        to: { dueDate: '2026-11-25', dueTime: '10:00' },
      })
      expect(events.find((e) => e.type === 'task_updated')!.payload).toMatchObject({
        changes: { title: { from: 'Задача', to: 'Новое' }, priority: { from: 'medium', to: 'high' } },
      })
      expect((await ownerNotices(task.id)).map((n) => n.event).sort()).toEqual(['due_changed', 'task_created'])
    })

    it('manages coexecutors through the responsible', async () => {
      const task = await create('alpha', { responsibleId: ids.beta })
      expect(await workspaceIds('gamma')).not.toContain(task.id)

      const added = await call('beta', 'PUT', `/api/tasks/${task.id}/coexecutors`, { userIds: [ids.gamma, ids.gamma] })
      expect(added.statusCode).toBe(200)
      expect(added.json<Task>().coexecutorIds).toEqual([ids.gamma])
      expect(await workspaceIds('gamma')).toContain(task.id)

      expect((await call('gamma', 'PUT', `/api/tasks/${task.id}/coexecutors`, { userIds: [] })).statusCode).toBe(403)
      expect((await call('beta', 'PUT', `/api/tasks/${task.id}/coexecutors`, { userIds: [ids.beta] })).statusCode).toBe(400)

      const swapped = await call('alpha', 'PUT', `/api/tasks/${task.id}/coexecutors`, { userIds: [ids.delta] })
      expect(swapped.json<Task>().coexecutorIds).toEqual([ids.delta])
      const changes = (await eventsOf(task.id)).filter((e) => e.type === 'coexecutors_changed').map((e) => e.payload)
      expect(changes).toContainEqual({ added: [ids.delta], removed: [ids.gamma] })
    })
  })

  describe('due change requests', () => {
    it('lets the responsible ask and the author decide', async () => {
      const task = await create('alpha', { responsibleId: ids.beta })
      const ask = { dueDate: '2026-12-05', dueTime: '18:00', reason: 'Ждём поставщика' }

      expect((await call('alpha', 'POST', `/api/tasks/${task.id}/due-requests`, ask)).statusCode).toBe(403)
      const created = await call('beta', 'POST', `/api/tasks/${task.id}/due-requests`, ask)
      expect(created.statusCode).toBe(201)
      const request = created.json<DueRequestDto>()
      expect(request).toMatchObject({ taskId: task.id, requestedBy: ids.beta, newDueDate: '2026-12-05', newDueTime: '18:00', state: 'pending' })

      const again = await call('beta', 'POST', `/api/tasks/${task.id}/due-requests`, ask)
      expect(again.statusCode).toBe(409)
      expect(again.json()).toMatchObject({ error: 'due_request_pending' })

      const seen = (await call('alpha', 'GET', `/api/tasks/${task.id}`)).json<TaskDetailsDto>()
      expect(seen.pendingDueRequest?.id).toBe(request.id)
      expect(seen.allowedActions.decideDueRequest).toBe(true)

      expect((await call('beta', 'POST', `/api/due-requests/${request.id}/decide`, { approve: true })).statusCode).toBe(403)
      expect((await call('delta', 'POST', `/api/due-requests/${request.id}/decide`, { approve: true })).statusCode).toBe(404)

      const approved = await call('alpha', 'POST', `/api/due-requests/${request.id}/decide`, { approve: true, comment: 'Ок' })
      expect(approved.statusCode).toBe(200)
      const details = approved.json<TaskDetailsDto>()
      expect(details.task).toMatchObject({ dueDate: '2026-12-05', dueTime: '18:00' })
      expect(details.pendingDueRequest).toBeNull()
      expect(details.events.slice(0, 3).map((e) => e.type)).toEqual(['due_change_decided', 'due_changed', 'due_change_requested'])
      expect(details.events[0]!.payload).toMatchObject({ requestId: request.id, approved: true, comment: 'Ок' })

      const twice = await call('alpha', 'POST', `/api/due-requests/${request.id}/decide`, { approve: false })
      expect(twice.statusCode).toBe(409)

      // A rejection leaves the due date alone.
      const second = (await call('beta', 'POST', `/api/tasks/${task.id}/due-requests`, { dueDate: '2027-01-10', reason: 'Праздники' })).json<DueRequestDto>()
      const rejected = (await call('alpha', 'POST', `/api/due-requests/${second.id}/decide`, { approve: false })).json<TaskDetailsDto>()
      expect(rejected.task.dueDate).toBe('2026-12-05')

      const notices = (await ownerNotices(task.id)).map((n) => n.event).sort()
      expect(notices).toEqual(['due_change_requested', 'due_change_requested', 'due_changed', 'task_created'])
    })

    it('does not let anyone ask to move a hot task', async () => {
      const task = await create('owner', { responsibleId: ids.gamma, priority: 'hot' })
      const response = await call('gamma', 'POST', `/api/tasks/${task.id}/due-requests`, { dueDate: '2026-12-01', reason: 'никак' })
      expect(response.statusCode).toBe(403)
    })
  })

  describe('checklist and progress', () => {
    it('lets the author and the responsible edit items and counts progress', async () => {
      const task = await create('alpha', { responsibleId: ids.beta, coexecutorIds: [ids.gamma] })
      const add = (who: Who, text: string) => call(who, 'POST', `/api/tasks/${task.id}/checklist`, { text })

      const first = (await add('alpha', 'Первый')).json<{ id: string; sort: number }>()
      const second = await add('beta', 'Второй')
      expect(second.statusCode).toBe(201)
      await add('alpha', 'Третий')
      expect((await add('gamma', 'Соисполнитель')).statusCode).toBe(403)

      const ticked = await call('beta', 'PATCH', `/api/checklist/${first.id}`, { done: true })
      expect(ticked.json()).toMatchObject({ id: first.id, done: true, text: 'Первый' })
      expect((await call('gamma', 'PATCH', `/api/checklist/${first.id}`, { done: false })).statusCode).toBe(403)
      expect((await call('delta', 'PATCH', `/api/checklist/${first.id}`, { done: false })).statusCode).toBe(404)

      const sub1 = await create('beta', { responsibleId: ids.beta, parentId: task.id })
      await create('beta', { responsibleId: ids.delta, parentId: task.id })
      await transition('beta', sub1.id, { to: 'done' })

      await testDb.db.insert(messages).values([
        { taskId: task.id, authorId: ids.gamma, body: 'привет' },
        { taskId: task.id, authorId: ids.gamma, body: 'удалено', deletedAt: new Date() },
      ])

      const card = await workspaceTask('alpha', task.id)
      expect(card).toMatchObject({
        checklist: { done: 1, total: 3 },
        subtasks: { done: 1, total: 2 },
        commentCount: 1,
        coexecutorIds: [ids.gamma],
      })

      expect((await call('alpha', 'DELETE', `/api/checklist/${first.id}`)).statusCode).toBe(204)
      expect((await call('alpha', 'DELETE', `/api/checklist/${first.id}`)).statusCode).toBe(404)
      const details = (await call('alpha', 'GET', `/api/tasks/${task.id}`)).json<TaskDetailsDto>()
      expect(details.checklist.map((i) => i.text)).toEqual(['Второй', 'Третий'])
      expect(details.task.checklist).toEqual({ done: 0, total: 2 })
      // The subtask's own participants: delta sees only through its subtask.
      const forDelta = (await call('delta', 'GET', `/api/tasks/${task.id}`)).json<TaskDetailsDto>()
      expect(forDelta.subtasks.map((s) => s.responsibleId)).toEqual([ids.delta])

      const types = (await eventsOf(task.id)).map((e) => e.type)
      expect(types.filter((t) => t.startsWith('checklist_'))).toHaveLength(5)
    })
  })
})
