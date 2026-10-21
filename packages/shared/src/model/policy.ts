import type { Actor, Role, Task, TaskEvent, TaskStatus } from './types'

export type PolicyErrorCode =
  | 'invalid_transition'
  | 'forbidden'
  | 'document_required'
  | 'comment_required'

export type PolicyResult = { ok: true } | { ok: false; code: PolicyErrorCode }

export type HotLimitResult = { ok: true } | { ok: false; code: 'hot_limit'; conflictingTaskId: string }

export interface VisibilityContext {
  /** The parent task, when `task` is a subtask. */
  parent?: Task
  /** Everyone who participates in any subtask of `task`. */
  subtaskParticipantIds?: string[]
}

export interface TransitionOptions {
  comment?: string
  cancelled?: boolean
}

export interface AllowedActions {
  start: boolean
  complete: boolean
  cancel: boolean
  reopen: boolean
  edit: boolean
  changeDue: boolean
  requestDueChange: boolean
  decideDueRequest: boolean
  setHot: boolean
  setPriority: boolean
  manageCoexecutors: boolean
  addSubtask: boolean
  comment: boolean
}

const OK: PolicyResult = { ok: true }
const fail = (code: PolicyErrorCode): PolicyResult => ({ ok: false, code })

const isOwner = (actor: Actor) => actor.role === 'owner'
const isAuthor = (actor: Actor, task: Task) => task.authorId === actor.id
const isResponsible = (actor: Actor, task: Task) => task.responsibleId === actor.id
const isAuthorOrOwner = (actor: Actor, task: Task) => isOwner(actor) || isAuthor(actor, task)
/** Who may move a task forward: start or complete it. */
const isDriver = (actor: Actor, task: Task) =>
  isAuthorOrOwner(actor, task) || isResponsible(actor, task)
const hasComment = (comment?: string) => (comment ?? '').trim().length > 0

/** Author, responsible or coexecutor. */
export function isParticipant(actorId: string, task: Task): boolean {
  return (
    task.authorId === actorId ||
    task.responsibleId === actorId ||
    task.coexecutorIds.includes(actorId)
  )
}

export function canSee(actor: Actor, task: Task, ctx: VisibilityContext = {}): boolean {
  if (isOwner(actor)) return true
  if (isParticipant(actor.id, task)) return true
  if (task.parentId !== null && ctx.parent && isParticipant(actor.id, ctx.parent)) return true
  return ctx.subtaskParticipantIds?.includes(actor.id) ?? false
}

/** Directors may assign to anyone, themselves included, except an owner. */
export function canCreateTask(actor: Actor, _responsibleId: string, responsibleRole: Role): boolean {
  return isOwner(actor) || responsibleRole !== 'owner'
}

export function canCreateSubtask(actor: Actor, parent: Task, assigneeRole: Role): boolean {
  if (!canAddSubtaskTo(actor, parent)) return false
  return isOwner(actor) || assigneeRole !== 'owner'
}

function canAddSubtaskTo(actor: Actor, parent: Task): boolean {
  if (parent.parentId !== null || parent.status === 'done') return false
  return isDriver(actor, parent)
}

export function checkTransition(
  actor: Actor,
  task: Task,
  to: TaskStatus,
  opts: TransitionOptions = {},
): PolicyResult {
  const from = task.status
  const cancelled = opts.cancelled === true

  if (cancelled) {
    // Cancel = close as done with a mark; only from an open status.
    if (to !== 'done' || from === 'done') return fail('invalid_transition')
    if (!isAuthorOrOwner(actor, task)) return fail('forbidden')
    if (!hasComment(opts.comment)) return fail('comment_required')
    return OK
  }

  if (from === 'new' && to === 'in_progress') {
    return isDriver(actor, task) ? OK : fail('forbidden')
  }

  if (from !== 'done' && to === 'done') {
    if (!isDriver(actor, task)) return fail('forbidden')
    if (task.requiresDocument && task.attachmentCount === 0) return fail('document_required')
    return OK
  }

  if (from === 'done' && to === 'in_progress') {
    if (!isAuthorOrOwner(actor, task)) return fail('forbidden')
    if (!hasComment(opts.comment)) return fail('comment_required')
    return OK
  }

  return fail('invalid_transition')
}

/**
 * What the UI may offer. Flags reflect permission and task state only;
 * input-dependent checks (comments, attached document) stay in checkTransition.
 */
export function allowedActions(actor: Actor, task: Task, ctx: VisibilityContext = {}): AllowedActions {
  const owner = isOwner(actor)
  const authorOrOwner = isAuthorOrOwner(actor, task)
  const driver = isDriver(actor, task)
  const done = task.status === 'done'
  const hot = task.priority === 'hot'

  return {
    start: driver && task.status === 'new',
    complete: driver && !done,
    cancel: authorOrOwner && !done,
    reopen: authorOrOwner && done,
    // A done task is frozen: the only way to change it is to reopen it first.
    edit: authorOrOwner && !done,
    changeDue: (hot ? owner : authorOrOwner) && !done,
    requestDueChange: isResponsible(actor, task) && !isAuthor(actor, task) && !done && !hot,
    decideDueRequest: authorOrOwner && !done,
    setHot: owner && !done,
    // Only the owner may take 'hot' off, so a hot task's priority is owner-only.
    setPriority: (hot ? owner : authorOrOwner) && !done,
    manageCoexecutors: driver && !done,
    addSubtask: canAddSubtaskTo(actor, task),
    comment: !done && canSee(actor, task, ctx),
  }
}

/**
 * At most one open hot task per responsible.
 * `responsibleOpenHotTaskIds` are the responsible's hot tasks that are not done.
 */
export function checkHotLimit(responsibleOpenHotTaskIds: string[], taskId: string): HotLimitResult {
  const conflictingTaskId = responsibleOpenHotTaskIds.find((id) => id !== taskId)
  return conflictingTaskId === undefined
    ? { ok: true }
    : { ok: false, code: 'hot_limit', conflictingTaskId }
}

export type OwnerNotice = 'immediate' | 'digest'

const OWNER_NOTICE: Record<TaskEvent, OwnerNotice | null> = {
  task_reopened: 'immediate',
  task_overdue: 'immediate',
  hot_set: 'immediate',
  task_created: 'digest',
  task_completed: 'digest',
  task_cancelled: 'digest',
  due_changed: 'digest',
  due_change_requested: 'digest',
  task_started: null,
  // Addressed to the responsible, not the owner.
  due_change_decided: null,
  due_reminder: null,
  task_updated: null,
  coexecutors_changed: null,
  checklist_item_added: null,
  checklist_item_updated: null,
  checklist_item_removed: null,
}

/** How the owner hears about an event; `actor === null` is a system event. */
export function ownerNotice(event: TaskEvent, actor: Actor | null): OwnerNotice | null {
  if (actor && isOwner(actor)) return null
  return OWNER_NOTICE[event]
}
