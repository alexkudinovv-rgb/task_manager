import {
  canSee,
  isOverdue,
  progress,
  type Actor,
  type Progress,
  type Task,
  type VisibilityContext,
} from '@car-city/shared/model'
import type { DirectoryItem, User, Workspace } from './api'
import { formatDue, moscowToday } from './dates'

export interface Lookup {
  now: Date
  /** Moscow date, YYYY-MM-DD. */
  today: string
  users: Map<string, User>
  units: Map<string, DirectoryItem>
  positions: Map<string, DirectoryItem>
  tasks: Map<string, Task>
  subtasksByParent: Map<string, Task[]>
}

export function buildLookup(workspace: Workspace, now: Date): Lookup {
  const subtasksByParent = new Map<string, Task[]>()
  for (const task of workspace.tasks) {
    if (task.parentId === null) continue
    subtasksByParent.set(task.parentId, [...(subtasksByParent.get(task.parentId) ?? []), task])
  }
  return {
    now,
    today: moscowToday(now),
    users: byId(workspace.users),
    units: byId(workspace.units),
    positions: byId(workspace.positions),
    tasks: byId(workspace.tasks),
    subtasksByParent,
  }
}

function byId<T extends { id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]))
}

export function fullName(user: User): string {
  return `${user.firstName} ${user.lastName}`.trim()
}

export function initials(user: User): string {
  return `${user.firstName.charAt(0)}${user.lastName.charAt(0)}`.toUpperCase()
}

export function findUser(lookup: Lookup, id: string): User {
  const user = lookup.users.get(id)
  if (!user) throw new Error(`Unknown user: ${id}`)
  return user
}

/** What canSee needs beyond the task itself: the parent, or who works on its subtasks. */
export function visibilityContext(task: Task, lookup: Lookup): VisibilityContext {
  if (task.parentId !== null) return { parent: lookup.tasks.get(task.parentId) }
  const subtasks = lookup.subtasksByParent.get(task.id) ?? []
  return { subtaskParticipantIds: subtasks.flatMap((s) => [s.authorId, s.responsibleId, ...s.coexecutorIds]) }
}

export function canViewerSee(viewer: Actor, task: Task, lookup: Lookup): boolean {
  return canSee(viewer, task, visibilityContext(task, lookup))
}

/** Everything a card, row or panel needs about one task, resolved once. */
export interface TaskView {
  task: Task
  author: User
  responsible: User
  coexecutors: User[]
  /** Unit of the responsible. */
  unit: DirectoryItem | null
  hot: boolean
  overdue: boolean
  dueLabel: string
  progress: Progress
}

export function resolveTask(task: Task, lookup: Lookup): TaskView {
  const responsible = findUser(lookup, task.responsibleId)
  const overdue = isOverdue(task, lookup.now)
  return {
    task,
    author: findUser(lookup, task.authorId),
    responsible,
    coexecutors: task.coexecutorIds.map((id) => findUser(lookup, id)),
    unit: responsible.unitId ? (lookup.units.get(responsible.unitId) ?? null) : null,
    hot: task.priority === 'hot' && task.status !== 'done',
    overdue,
    dueLabel: formatDue(task, lookup.today, overdue),
    progress: progress(task),
  }
}

// A date-only deadline lasts the whole day, so it sorts after any timed one.
const dueKey = (task: Task) => `${task.dueDate} ${task.dueTime ?? '24:00'}`

/** Open before done; then hot, overdue, and the nearest deadline. */
export function byUrgency(a: TaskView, b: TaskView): number {
  const isDone = (view: TaskView) => Number(view.task.status === 'done')
  return (
    isDone(a) - isDone(b) ||
    Number(b.hot) - Number(a.hot) ||
    Number(b.overdue) - Number(a.overdue) ||
    dueKey(a.task).localeCompare(dueKey(b.task))
  )
}
