import type { Task, VisibilityContext } from '@car-city/shared/model'
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, ne, or, sql, type SQL } from 'drizzle-orm'
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres'
import { alias, type AnyPgColumn, type PgDatabase } from 'drizzle-orm/pg-core'
import type * as schema from '../../db/schema'
import {
  attachments,
  checklistItems,
  dueChangeRequests,
  messages,
  positions,
  taskCoexecutors,
  taskEvents,
  tasks,
  units,
  users,
} from '../../db/schema'
import { EMPTY_COUNTER, toTask, type TaskExtras } from './mapping'

/** The database or an open transaction: both run the same queries. */
export type Conn = PgDatabase<NodePgQueryResultHKT, typeof schema>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Ids reach SQL as uuid; anything else would be a 500 from Postgres instead of a clean 4xx. */
export const isUuid = (value: string) => UUID.test(value)

export const EVENTS_LIMIT = 100

/** Tasks matching `where` (all when omitted) with participants and counters, in a fixed number of queries. */
export async function loadTasks(conn: Conn, where?: SQL): Promise<Task[]> {
  const rows = await conn.select().from(tasks).where(where).orderBy(asc(tasks.createdAt), asc(tasks.id))
  if (rows.length === 0) return []
  const ids = rows.map((row) => row.id)

  // Sequential on purpose: inside a transaction all queries share one pg client.
  const coexecutors = await conn
    .select({ taskId: taskCoexecutors.taskId, userId: taskCoexecutors.userId })
    .from(taskCoexecutors)
    .where(inArray(taskCoexecutors.taskId, ids))
    .orderBy(asc(taskCoexecutors.addedAt), asc(taskCoexecutors.userId))
  const subtaskCounts = await conn
    .select({
      taskId: tasks.parentId,
      total: count(),
      done: sql<number>`count(*) filter (where ${tasks.status} = 'done')`.mapWith(Number),
    })
    .from(tasks)
    .where(inArray(tasks.parentId, ids))
    .groupBy(tasks.parentId)
  const checklistCounts = await conn
    .select({
      taskId: checklistItems.taskId,
      total: count(),
      done: sql<number>`count(*) filter (where ${checklistItems.done})`.mapWith(Number),
    })
    .from(checklistItems)
    .where(inArray(checklistItems.taskId, ids))
    .groupBy(checklistItems.taskId)
  // The required document is a file attached to the task itself, not to a chat message.
  const attachmentCounts = await conn
    .select({ taskId: attachments.taskId, total: count() })
    .from(attachments)
    .where(inArray(attachments.taskId, ids))
    .groupBy(attachments.taskId)
  const commentCounts = await conn
    .select({ taskId: messages.taskId, total: count() })
    .from(messages)
    .where(and(inArray(messages.taskId, ids), isNull(messages.deletedAt)))
    .groupBy(messages.taskId)

  const coexecutorsByTask = new Map<string, string[]>()
  for (const { taskId, userId } of coexecutors) {
    coexecutorsByTask.set(taskId, [...(coexecutorsByTask.get(taskId) ?? []), userId])
  }
  const counters = (list: { taskId: string | null; total: number; done: number }[]) =>
    new Map(list.map((c) => [c.taskId, { done: c.done, total: c.total }]))
  const totals = (list: { taskId: string | null; total: number }[]) => new Map(list.map((c) => [c.taskId, c.total]))
  const subtasks = counters(subtaskCounts)
  const checklist = counters(checklistCounts)
  const files = totals(attachmentCounts)
  const comments = totals(commentCounts)

  return rows.map((row) => {
    const extras: TaskExtras = {
      coexecutorIds: coexecutorsByTask.get(row.id) ?? [],
      subtasks: subtasks.get(row.id) ?? EMPTY_COUNTER,
      checklist: checklist.get(row.id) ?? EMPTY_COUNTER,
      attachmentCount: files.get(row.id) ?? 0,
      commentCount: comments.get(row.id) ?? 0,
    }
    return toTask(row, extras)
  })
}

type TaskColumns = { id: AnyPgColumn; authorId: AnyPgColumn; responsibleId: AnyPgColumn }

/** Author, responsible or coexecutor of `t` (tasks or an alias of it). */
function participates(conn: Conn, t: TaskColumns, userId: string): SQL {
  const coexecuted = conn
    .select({ id: taskCoexecutors.taskId })
    .from(taskCoexecutors)
    .where(eq(taskCoexecutors.userId, userId))
  return or(eq(t.authorId, userId), eq(t.responsibleId, userId), inArray(t.id, coexecuted))!
}

/**
 * Coarse SQL filter matching canSee for a non-owner: tasks the user participates in, subtasks of
 * those, and parents of subtasks they participate in. The caller confirms each row with canSee.
 */
export function visibleTo(conn: Conn, userId: string): SQL {
  const p = alias(tasks, 'p')
  const participated = conn.select({ id: p.id }).from(p).where(participates(conn, p, userId))
  const parentsOfParticipated = conn
    .select({ id: p.parentId })
    .from(p)
    .where(and(participates(conn, p, userId), isNotNull(p.parentId)))
  return or(
    participates(conn, tasks, userId),
    inArray(tasks.parentId, participated),
    inArray(tasks.id, parentsOfParticipated),
  )!
}

/** The task, its parent and its subtasks: everything canSee and allowedActions need about one task. */
export function loadFamily(conn: Conn, taskId: string): Promise<Task[]> {
  const p = alias(tasks, 'p')
  const parentOf = conn.select({ id: p.parentId }).from(p).where(eq(p.id, taskId))
  return loadTasks(conn, or(eq(tasks.id, taskId), eq(tasks.parentId, taskId), inArray(tasks.id, parentOf)))
}

export const participantsOf = (task: Task): string[] => [task.authorId, task.responsibleId, ...task.coexecutorIds]

/** Visibility context for `task` from a set of loaded tasks that contains its parent and subtasks. */
export function contextFrom(task: Task, byId: Map<string, Task>, children: Task[]): VisibilityContext {
  return {
    parent: task.parentId === null ? undefined : byId.get(task.parentId),
    subtaskParticipantIds: children.flatMap(participantsOf),
  }
}

/** Row lock so concurrent changes to one task apply one after another. */
export async function lockTask(conn: Conn, taskId: string): Promise<void> {
  await conn.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, taskId)).for('update')
}

/** The responsible's hot tasks that are not done. */
export async function openHotTaskIds(conn: Conn, responsibleId: string): Promise<string[]> {
  const rows = await conn
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.responsibleId, responsibleId), eq(tasks.priority, 'hot'), ne(tasks.status, 'done')))
  return rows.map((row) => row.id)
}

export async function findUser(conn: Conn, userId: string) {
  if (!isUuid(userId)) return undefined
  const [row] = await conn.select().from(users).where(eq(users.id, userId))
  return row
}

export async function activeUserIds(conn: Conn, userIds: string[]): Promise<Set<string>> {
  const valid = userIds.filter(isUuid)
  if (valid.length === 0) return new Set()
  const rows = await conn
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.id, valid), isNull(users.disabledAt)))
  return new Set(rows.map((row) => row.id))
}

export async function ownerId(conn: Conn): Promise<string | null> {
  const [row] = await conn.select({ id: users.id }).from(users).where(eq(users.role, 'owner')).limit(1)
  return row?.id ?? null
}

export function loadDirectory(conn: Conn) {
  return Promise.all([
    conn.select().from(users).orderBy(asc(users.lastName), asc(users.firstName)),
    conn.select({ id: positions.id, name: positions.name }).from(positions).orderBy(asc(positions.sort), asc(positions.name)),
    conn.select({ id: units.id, name: units.name }).from(units).orderBy(asc(units.sort), asc(units.name)),
  ])
}

export function loadChecklist(conn: Conn, taskId: string) {
  return conn
    .select()
    .from(checklistItems)
    .where(eq(checklistItems.taskId, taskId))
    .orderBy(asc(checklistItems.sort), asc(checklistItems.createdAt))
}

export async function findChecklistItem(conn: Conn, itemId: string) {
  if (!isUuid(itemId)) return undefined
  const [row] = await conn.select().from(checklistItems).where(eq(checklistItems.id, itemId))
  return row
}

export async function nextChecklistSort(conn: Conn, taskId: string): Promise<number> {
  const [row] = await conn
    .select({ max: sql<number>`coalesce(max(${checklistItems.sort}), 0)`.mapWith(Number) })
    .from(checklistItems)
    .where(eq(checklistItems.taskId, taskId))
  return (row?.max ?? 0) + 1
}

export function loadEvents(conn: Conn, taskId: string) {
  return conn
    .select()
    .from(taskEvents)
    .where(eq(taskEvents.taskId, taskId))
    .orderBy(desc(taskEvents.at), desc(taskEvents.id))
    .limit(EVENTS_LIMIT)
}

export async function findPendingDueRequest(conn: Conn, taskId: string) {
  const [row] = await conn
    .select()
    .from(dueChangeRequests)
    .where(and(eq(dueChangeRequests.taskId, taskId), eq(dueChangeRequests.state, 'pending')))
  return row
}

export async function findDueRequest(conn: Conn, requestId: string) {
  if (!isUuid(requestId)) return undefined
  const [row] = await conn.select().from(dueChangeRequests).where(eq(dueChangeRequests.id, requestId))
  return row
}
