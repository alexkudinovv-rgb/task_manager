import {
  allowedActions,
  canCreateSubtask,
  canCreateTask,
  canSee,
  checkHotLimit,
  checkTransition,
  type Actor,
  type AllowedActions,
  type ChecklistItemDto,
  type ChecklistItemInput,
  type ChecklistItemPatch,
  type CoexecutorsInput,
  type CreateTaskInput,
  type DecideDueRequestInput,
  type DueChangeRequestInput,
  type DueRequestDto,
  type PolicyErrorCode,
  type Task,
  type TaskDetailsDto,
  type TransitionInput,
  type UpdateTaskInput,
  type VisibilityContext,
  type WorkspaceDto,
} from '@car-city/shared/model'
import { and, eq, inArray } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { checklistItems, dueChangeRequests, taskCoexecutors, tasks, type NewTask } from '../../db/schema'
import { apiError } from '../../http/errors'
import { connectedViewers, publishTaskChanged } from '../chats/service'
import { EventLog } from './events'
import { toChecklistItemDto, toDirectoryItem, toDueRequestDto, toEventDto, toHhmm, toUserDto } from './mapping'
import {
  activeUserIds,
  contextFrom,
  findChecklistItem,
  findDueRequest,
  findPendingDueRequest,
  findUser,
  isUuid,
  loadChecklist,
  loadDirectory,
  loadEvents,
  loadFamily,
  loadTasks,
  lockTask,
  nextChecklistSort,
  openHotTaskIds,
  participantsOf,
  visibleTo,
  type Conn,
} from './repository'

interface TaskView {
  task: Task
  parent: Task | undefined
  subtasks: Task[]
  ctx: VisibilityContext
}

/** What a unique violation of the hot index should report (set before the write). */
interface HotGuard {
  responsibleId?: string
  taskId?: string
}

interface Mutation {
  tx: Conn
  view: TaskView
  allowed: AllowedActions
  log: EventLog
  guard: HotGuard
}

const notFound = (message = 'Задача не найдена') => apiError(404, 'not_found', { message })
const forbidden = (message = 'Недостаточно прав для этого действия') => apiError(403, 'forbidden', { message })
const invalid = (message: string) => apiError(400, 'validation', { message })

const HOT_LIMIT_MESSAGE = 'У ответственного уже есть горящая задача'
const DUE_PENDING_MESSAGE = 'Запрос на перенос срока уже ждёт решения'
const POLICY_MESSAGES: Record<PolicyErrorCode, string> = {
  forbidden: 'Недостаточно прав для этого действия',
  invalid_transition: 'Такой переход статуса невозможен',
  comment_required: 'Нужен комментарий',
  document_required: 'Сначала приложите документ',
}

/** SQLSTATE 23505 constraint name; drizzle wraps the pg error in `cause`. */
function uniqueViolation(error: unknown): string | undefined {
  const e = error as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } }
  const pg = e.cause?.code ? e.cause : e
  return pg.code === '23505' ? pg.constraint : undefined
}

function need(allowed: AllowedActions, action: keyof AllowedActions, message?: string): void {
  if (!allowed[action]) throw forbidden(message)
}

/** Checklist items are changed by whoever may edit the task or drive it (author, owner, responsible). */
const canEditChecklist = (allowed: AllowedActions) => allowed.edit || allowed.manageCoexecutors

const dueOf = (task: { dueDate: string; dueTime: string | null }) => ({ dueDate: task.dueDate, dueTime: task.dueTime })

export class TaskService {
  constructor(private readonly db: Db) {}

  // ---------- reads ----------

  async workspace(actor: Actor): Promise<WorkspaceDto> {
    const where = actor.role === 'owner' ? undefined : visibleTo(this.db, actor.id)
    const [candidates, [userRows, positions, units]] = await Promise.all([
      loadTasks(this.db, where),
      loadDirectory(this.db),
    ])
    const byId = new Map(candidates.map((task) => [task.id, task]))
    const children = new Map<string, Task[]>()
    for (const task of candidates) {
      if (task.parentId !== null) children.set(task.parentId, [...(children.get(task.parentId) ?? []), task])
    }
    const visible = candidates.filter((task) => canSee(actor, task, contextFrom(task, byId, children.get(task.id) ?? [])))
    const users = userRows.map(toUserDto)
    const me = users.find((user) => user.id === actor.id)
    if (!me) throw apiError(401, 'unauthorized')
    return { me, users, positions: positions.map(toDirectoryItem), units: units.map(toDirectoryItem), tasks: visible }
  }

  async details(actor: Actor, taskId: string): Promise<TaskDetailsDto> {
    if (!isUuid(taskId)) throw notFound()
    return this.buildDetails(this.db, actor, await this.view(this.db, actor, taskId))
  }

  // ---------- tasks ----------

  async create(actor: Actor, input: CreateTaskInput): Promise<Task> {
    const created = await this.run(async (tx, guard) => {
      const responsible = await findUser(tx, input.responsibleId)
      if (!responsible || responsible.disabledAt) throw invalid('Ответственный не найден')

      let parent: Task | undefined
      if (input.parentId !== undefined) {
        if (!isUuid(input.parentId)) throw notFound()
        await lockTask(tx, input.parentId)
        parent = (await this.view(tx, actor, input.parentId)).task
        if (parent.parentId !== null) throw invalid('Подзадачи бывают только одного уровня')
        if (parent.status === 'done') throw invalid('Задача завершена: сначала верните её в работу')
        if (!canCreateSubtask(actor, parent, responsible.role)) throw forbidden()
      } else if (!canCreateTask(actor, responsible.id, responsible.role)) {
        throw forbidden('Руководитель не может ставить задачи собственнику')
      }

      const coexecutorIds = await checkCoexecutors(tx, input.coexecutorIds, responsible.id, [])
      const draft: Task = {
        id: '',
        parentId: parent?.id ?? null,
        title: input.title,
        description: input.description,
        authorId: actor.id,
        responsibleId: responsible.id,
        coexecutorIds,
        status: 'new',
        priority: input.priority,
        dueDate: input.dueDate,
        dueTime: input.dueTime ?? null,
        startDate: input.startDate ?? null,
        requiresDocument: input.requiresDocument,
        cancelled: false,
        createdAt: new Date().toISOString(),
        completedAt: null,
        attachmentCount: 0,
        checklist: { done: 0, total: 0 },
        subtasks: { done: 0, total: 0 },
        commentCount: 0,
      }
      if (draft.priority === 'hot') {
        need(allowedActions(actor, draft), 'setHot', '«Горит» ставит только собственник')
        await ensureHotSlot(tx, guard, draft.responsibleId, '')
      }

      const [row] = await tx
        .insert(tasks)
        .values({
          parentId: draft.parentId,
          title: draft.title,
          description: draft.description,
          authorId: draft.authorId,
          responsibleId: draft.responsibleId,
          priority: draft.priority,
          dueDate: draft.dueDate,
          dueTime: draft.dueTime,
          startDate: draft.startDate,
          requiresDocument: draft.requiresDocument,
        })
        .returning({ id: tasks.id })
      const task = { id: row!.id, title: draft.title }
      if (coexecutorIds.length > 0) {
        await tx.insert(taskCoexecutors).values(coexecutorIds.map((userId) => ({ taskId: task.id, userId })))
      }

      const log = new EventLog(tx, actor)
      await log.record(task, 'task_created', {
        parentId: draft.parentId,
        responsibleId: draft.responsibleId,
        coexecutorIds,
        priority: draft.priority,
        ...dueOf(draft),
      })
      if (draft.priority === 'hot') await log.record(task, 'hot_set', { from: null })
      return reload(tx, task.id)
    })
    await this.announce(created.id, created.parentId, [])
    return created
  }

  async update(actor: Actor, taskId: string, input: UpdateTaskInput): Promise<Task> {
    return this.mutate(actor, taskId, async ({ tx, view, allowed, log, guard }) => {
      const { task } = view
      const patch: Partial<NewTask> = {}
      const changes: Record<string, { from: unknown; to: unknown }> = {}
      const edit = <K extends 'title' | 'description' | 'requiresDocument' | 'startDate'>(key: K, value: Task[K] | undefined) => {
        if (value === undefined || value === task[key]) return
        need(allowed, 'edit')
        Object.assign(patch, { [key]: value })
        changes[key] = { from: task[key], to: value }
      }
      edit('title', input.title)
      edit('description', input.description)
      edit('requiresDocument', input.requiresDocument)
      edit('startDate', input.startDate)

      let responsibleId = task.responsibleId
      if (input.responsibleId !== undefined && input.responsibleId !== task.responsibleId) {
        need(allowed, 'edit')
        const responsible = await findUser(tx, input.responsibleId)
        if (!responsible || responsible.disabledAt) throw invalid('Ответственный не найден')
        if (!canCreateTask(actor, responsible.id, responsible.role)) {
          throw forbidden('Руководитель не может назначить задачу собственнику')
        }
        responsibleId = responsible.id
        patch.responsibleId = responsibleId
        changes.responsibleId = { from: task.responsibleId, to: responsibleId }
      }

      const due = {
        dueDate: input.dueDate ?? task.dueDate,
        dueTime: input.dueTime === undefined ? task.dueTime : input.dueTime,
      }
      const dueChanged = due.dueDate !== task.dueDate || due.dueTime !== task.dueTime
      if (dueChanged) {
        need(allowed, 'changeDue', task.priority === 'hot' ? 'Срок горящей задачи меняет только собственник' : undefined)
        patch.dueDate = due.dueDate
        patch.dueTime = due.dueTime
      }

      const priority = input.priority ?? task.priority
      const priorityChanged = priority !== task.priority
      if (priorityChanged) {
        if (priority === 'hot') need(allowed, 'setHot', '«Горит» ставит только собственник')
        else need(allowed, 'setPriority', task.priority === 'hot' ? '«Горит» снимает только собственник' : undefined)
        patch.priority = priority
        if (priority !== 'hot') changes.priority = { from: task.priority, to: priority }
      }
      if (priority === 'hot' && (priorityChanged || responsibleId !== task.responsibleId)) {
        await ensureHotSlot(tx, guard, responsibleId, task.id)
      }

      if (Object.keys(patch).length === 0) return task
      await tx.update(tasks).set(patch).where(eq(tasks.id, task.id))
      if (responsibleId !== task.responsibleId && task.coexecutorIds.includes(responsibleId)) {
        // The new responsible stops being a coexecutor of the same task.
        await tx
          .delete(taskCoexecutors)
          .where(and(eq(taskCoexecutors.taskId, task.id), eq(taskCoexecutors.userId, responsibleId)))
      }

      const ref = { id: task.id, title: patch.title ?? task.title }
      if (Object.keys(changes).length > 0) await log.record(ref, 'task_updated', { changes })
      if (dueChanged) await log.record(ref, 'due_changed', { from: dueOf(task), to: due })
      if (priorityChanged && priority === 'hot') await log.record(ref, 'hot_set', { from: task.priority })
      return reload(tx, task.id)
    })
  }

  async transition(actor: Actor, taskId: string, input: TransitionInput): Promise<Task> {
    return this.mutate(actor, taskId, async ({ tx, view, log, guard }) => {
      const { task } = view
      const result = checkTransition(actor, task, input.to, { comment: input.comment, cancelled: input.cancelled })
      if (!result.ok) {
        throw apiError(result.code === 'forbidden' ? 403 : 400, result.code, { message: POLICY_MESSAGES[result.code] })
      }

      const cancelled = input.cancelled === true
      let patch: Partial<NewTask>
      let event: 'task_started' | 'task_completed' | 'task_cancelled' | 'task_reopened'
      if (input.to === 'done') {
        patch = { status: 'done', completedAt: new Date(), cancelled }
        event = cancelled ? 'task_cancelled' : 'task_completed'
      } else if (task.status === 'done') {
        // A reopened hot task takes the responsible's hot slot again.
        if (task.priority === 'hot') await ensureHotSlot(tx, guard, task.responsibleId, task.id)
        patch = { status: input.to, completedAt: null, cancelled: false }
        event = 'task_reopened'
      } else {
        patch = { status: input.to }
        event = 'task_started'
      }

      await tx.update(tasks).set(patch).where(eq(tasks.id, task.id))
      const comment = input.comment?.trim()
      await log.record(task, event, { from: task.status, to: input.to, ...(comment ? { comment } : {}) })
      return reload(tx, task.id)
    })
  }

  async setCoexecutors(actor: Actor, taskId: string, input: CoexecutorsInput): Promise<Task> {
    return this.mutate(actor, taskId, async ({ tx, view, allowed, log }) => {
      const { task } = view
      need(allowed, 'manageCoexecutors')
      const next = await checkCoexecutors(tx, input.userIds, task.responsibleId, task.coexecutorIds)
      const added = next.filter((id) => !task.coexecutorIds.includes(id))
      const removed = task.coexecutorIds.filter((id) => !next.includes(id))
      if (added.length === 0 && removed.length === 0) return task

      if (removed.length > 0) {
        await tx
          .delete(taskCoexecutors)
          .where(and(eq(taskCoexecutors.taskId, task.id), inArray(taskCoexecutors.userId, removed)))
      }
      if (added.length > 0) {
        await tx.insert(taskCoexecutors).values(added.map((userId) => ({ taskId: task.id, userId })))
      }
      await log.record(task, 'coexecutors_changed', { added, removed })
      return reload(tx, task.id)
    })
  }

  // ---------- checklist ----------

  async addChecklistItem(actor: Actor, taskId: string, input: ChecklistItemInput): Promise<ChecklistItemDto> {
    return this.mutate(actor, taskId, async ({ tx, view, allowed, log }) => {
      if (!canEditChecklist(allowed)) throw forbidden()
      const sort = await nextChecklistSort(tx, view.task.id)
      const [item] = await tx.insert(checklistItems).values({ taskId: view.task.id, text: input.text, sort }).returning()
      await log.record(view.task, 'checklist_item_added', { itemId: item!.id, text: item!.text })
      return toChecklistItemDto(item!)
    })
  }

  async updateChecklistItem(actor: Actor, itemId: string, input: ChecklistItemPatch): Promise<ChecklistItemDto> {
    const taskId = await this.checklistTaskId(itemId)
    return this.mutate(actor, taskId, async ({ tx, view, allowed, log }) => {
      const item = await findChecklistItem(tx, itemId)
      if (!item || item.taskId !== view.task.id) throw notFound('Пункт не найден')
      if (!canEditChecklist(allowed)) throw forbidden()

      const patch: { text?: string; done?: boolean } = {}
      const changes: Record<string, { from: unknown; to: unknown }> = {}
      if (input.text !== undefined && input.text !== item.text) {
        patch.text = input.text
        changes.text = { from: item.text, to: input.text }
      }
      if (input.done !== undefined && input.done !== item.done) {
        patch.done = input.done
        changes.done = { from: item.done, to: input.done }
      }
      if (Object.keys(patch).length === 0) return toChecklistItemDto(item)

      const [updated] = await tx.update(checklistItems).set(patch).where(eq(checklistItems.id, item.id)).returning()
      await log.record(view.task, 'checklist_item_updated', { itemId: item.id, changes })
      return toChecklistItemDto(updated!)
    })
  }

  async deleteChecklistItem(actor: Actor, itemId: string): Promise<void> {
    const taskId = await this.checklistTaskId(itemId)
    await this.mutate(actor, taskId, async ({ tx, view, allowed, log }) => {
      const item = await findChecklistItem(tx, itemId)
      if (!item || item.taskId !== view.task.id) throw notFound('Пункт не найден')
      if (!canEditChecklist(allowed)) throw forbidden()
      await tx.delete(checklistItems).where(eq(checklistItems.id, item.id))
      await log.record(view.task, 'checklist_item_removed', { itemId: item.id, text: item.text })
    })
  }

  // ---------- due change requests ----------

  async requestDueChange(actor: Actor, taskId: string, input: DueChangeRequestInput): Promise<DueRequestDto> {
    return this.mutate(actor, taskId, async ({ tx, view, allowed, log }) => {
      const { task } = view
      need(
        allowed,
        'requestDueChange',
        task.priority === 'hot' ? 'Срок горящей задачи не переносится' : 'Перенос срока просит ответственный',
      )
      if (await findPendingDueRequest(tx, task.id)) throw apiError(409, 'due_request_pending', { message: DUE_PENDING_MESSAGE })
      const to = { dueDate: input.dueDate, dueTime: input.dueTime ?? null }
      const [request] = await tx
        .insert(dueChangeRequests)
        .values({ taskId: task.id, requestedBy: actor.id, newDueDate: to.dueDate, newDueTime: to.dueTime, reason: input.reason })
        .returning()
      await log.record(task, 'due_change_requested', { requestId: request!.id, from: dueOf(task), to, reason: input.reason })
      return toDueRequestDto(request!)
    })
  }

  async decideDueRequest(actor: Actor, requestId: string, input: DecideDueRequestInput): Promise<TaskDetailsDto> {
    const found = await findDueRequest(this.db, requestId)
    if (!found) throw notFound('Запрос не найден')
    return this.mutate(actor, found.taskId, async ({ tx, view, allowed, log }) => {
      const { task } = view
      need(allowed, 'decideDueRequest')
      const request = await findDueRequest(tx, requestId)
      if (!request || request.state !== 'pending') {
        throw apiError(409, 'conflict', { message: 'По этому запросу уже принято решение' })
      }
      // The task may have turned hot after the request: then only the owner may move its due date.
      if (input.approve) need(allowed, 'changeDue', 'Срок горящей задачи меняет только собственник')

      await tx
        .update(dueChangeRequests)
        .set({ state: input.approve ? 'approved' : 'rejected', decidedBy: actor.id, decidedAt: new Date() })
        .where(eq(dueChangeRequests.id, request.id))
      if (input.approve) {
        const to = { dueDate: request.newDueDate, dueTime: toHhmm(request.newDueTime) }
        await tx.update(tasks).set(to).where(eq(tasks.id, task.id))
        await log.record(task, 'due_changed', { from: dueOf(task), to, requestId: request.id })
      }
      const comment = input.comment?.trim()
      await log.record(task, 'due_change_decided', {
        requestId: request.id,
        approved: input.approve,
        requestedBy: request.requestedBy,
        ...(comment ? { comment } : {}),
      })
      return this.buildDetails(tx, actor, await this.view(tx, actor, task.id))
    })
  }

  // ---------- helpers ----------

  /** The task, its parent and subtasks; 404 when missing or not visible to the actor. */
  private async view(conn: Conn, actor: Actor, taskId: string): Promise<TaskView> {
    const family = await loadFamily(conn, taskId)
    const task = family.find((t) => t.id === taskId)
    if (!task) throw notFound()
    const byId = new Map(family.map((t) => [t.id, t]))
    const subtasks = family.filter((t) => t.parentId === taskId)
    const ctx = contextFrom(task, byId, subtasks)
    if (!canSee(actor, task, ctx)) throw notFound()
    return { task, parent: ctx.parent, subtasks, ctx }
  }

  private async buildDetails(conn: Conn, actor: Actor, view: TaskView): Promise<TaskDetailsDto> {
    const { task, parent, subtasks, ctx } = view
    // Sequential: `conn` may be a transaction (one pg client).
    const checklist = await loadChecklist(conn, task.id)
    const events = await loadEvents(conn, task.id)
    const pending = await findPendingDueRequest(conn, task.id)
    // Whoever sees a subtask sees its parent; checked anyway rather than assumed.
    const parentVisible = parent !== undefined && canSee(actor, parent, { subtaskParticipantIds: participantsOf(task) })
    return {
      task,
      parent: parentVisible ? parent : null,
      subtasks: subtasks.filter((sub) => canSee(actor, sub, { parent: task })),
      checklist: checklist.map(toChecklistItemDto),
      events: events.map(toEventDto),
      pendingDueRequest: pending ? toDueRequestDto(pending) : null,
      allowedActions: allowedActions(actor, task, ctx),
    }
  }

  private async checklistTaskId(itemId: string): Promise<string> {
    const item = await findChecklistItem(this.db, itemId)
    if (!item) throw notFound('Пункт не найден')
    return item.taskId
  }

  /** Locks the task, checks visibility (404) and runs `fn` in one transaction; then tells connected viewers. */
  private async mutate<T>(actor: Actor, taskId: string, fn: (m: Mutation) => Promise<T>): Promise<T> {
    if (!isUuid(taskId)) throw notFound()
    let parentId: string | null = null
    let viewersBefore: string[] = []
    const result = await this.run(async (tx, guard) => {
      await lockTask(tx, taskId)
      const view = await this.view(tx, actor, taskId)
      parentId = view.task.parentId
      viewersBefore = connectedViewers(view.task, view.ctx)
      return fn({ tx, view, guard, allowed: allowedActions(actor, view.task, view.ctx), log: new EventLog(tx, actor) })
    })
    await this.announce(taskId, parentId, viewersBefore)
    return result
  }

  /**
   * After the commit: `task.changed` for the task (to its viewers and to whoever saw it before, so a task
   * that moved away disappears from their board) and for the parent, whose progress counts subtasks.
   */
  private async announce(taskId: string, parentId: string | null, viewersBefore: string[]): Promise<void> {
    try {
      await publishTaskChanged(this.db, taskId, viewersBefore)
      if (parentId !== null) await publishTaskChanged(this.db, parentId)
    } catch {
      // The change is committed; clients catch up on their next reload or reconnect.
    }
  }

  /** A transaction whose unique violations (concurrent writers) become the same 409s as the pre-checks. */
  private async run<T>(fn: (tx: Conn, guard: HotGuard) => Promise<T>): Promise<T> {
    const guard: HotGuard = {}
    try {
      return await this.db.transaction((tx) => fn(tx, guard))
    } catch (error) {
      const constraint = uniqueViolation(error)
      if (constraint === 'tasks_one_hot_per_responsible') {
        const ids = guard.responsibleId ? await openHotTaskIds(this.db, guard.responsibleId) : []
        const conflictingTaskId = ids.find((id) => id !== guard.taskId)
        throw apiError(409, 'hot_limit', { message: HOT_LIMIT_MESSAGE, ...(conflictingTaskId ? { conflictingTaskId } : {}) })
      }
      if (constraint === 'due_change_requests_one_pending') {
        throw apiError(409, 'due_request_pending', { message: DUE_PENDING_MESSAGE })
      }
      throw error
    }
  }
}

async function reload(conn: Conn, taskId: string): Promise<Task> {
  const [task] = await loadTasks(conn, eq(tasks.id, taskId))
  return task!
}

async function ensureHotSlot(conn: Conn, guard: HotGuard, responsibleId: string, taskId: string): Promise<void> {
  guard.responsibleId = responsibleId
  guard.taskId = taskId
  const result = checkHotLimit(await openHotTaskIds(conn, responsibleId), taskId)
  if (!result.ok) throw apiError(409, 'hot_limit', { message: HOT_LIMIT_MESSAGE, conflictingTaskId: result.conflictingTaskId })
}

/** Deduplicated coexecutors; newly added ones must be active users, never the responsible. */
async function checkCoexecutors(conn: Conn, userIds: string[], responsibleId: string, current: string[]): Promise<string[]> {
  const ids = [...new Set(userIds)]
  if (ids.includes(responsibleId)) throw invalid('Ответственный не может быть соисполнителем')
  const added = ids.filter((id) => !current.includes(id))
  const active = await activeUserIds(conn, added)
  if (added.some((id) => !active.has(id))) throw invalid('Соисполнитель не найден или отключён')
  return ids
}
