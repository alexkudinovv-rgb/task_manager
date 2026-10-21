import type {
  ChecklistItemDto,
  Counter,
  DirectoryItem,
  DueRequestDto,
  Task,
  TaskEventDto,
  UserDto,
} from '@car-city/shared/model'
import type * as schema from '../../db/schema'

/** Per-task numbers that come from grouped queries, not from the tasks row. */
export interface TaskExtras {
  coexecutorIds: string[]
  subtasks: Counter
  checklist: Counter
  attachmentCount: number
  commentCount: number
}

export const EMPTY_COUNTER: Counter = { done: 0, total: 0 }

/** Postgres `time` comes back as HH:mm:ss; the model uses HH:mm. */
export const toHhmm = (value: string | null): string | null => (value === null ? null : value.slice(0, 5))

export function toTask(row: schema.Task, extras: TaskExtras): Task {
  return {
    id: row.id,
    parentId: row.parentId,
    title: row.title,
    description: row.description,
    authorId: row.authorId,
    responsibleId: row.responsibleId,
    coexecutorIds: extras.coexecutorIds,
    status: row.status,
    priority: row.priority,
    dueDate: row.dueDate,
    dueTime: toHhmm(row.dueTime),
    startDate: row.startDate,
    requiresDocument: row.requiresDocument,
    cancelled: row.cancelled,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    attachmentCount: extras.attachmentCount,
    checklist: extras.checklist,
    subtasks: extras.subtasks,
    commentCount: extras.commentCount,
  }
}

export function toUserDto(row: schema.User): UserDto {
  return {
    id: row.id,
    login: row.login,
    firstName: row.firstName,
    lastName: row.lastName,
    role: row.role,
    positionId: row.positionId,
    unitId: row.unitId,
    isAdmin: row.isAdmin,
    disabled: row.disabledAt !== null,
  }
}

export const toDirectoryItem = (row: { id: string; name: string }): DirectoryItem => ({ id: row.id, name: row.name })

export const toChecklistItemDto = (row: schema.ChecklistItem): ChecklistItemDto => ({
  id: row.id,
  text: row.text,
  done: row.done,
  sort: row.sort,
})

export const toEventDto = (row: schema.TaskEvent): TaskEventDto => ({
  id: row.id,
  type: row.type,
  actorId: row.actorId,
  at: row.at.toISOString(),
  payload: row.payload,
})

export const toDueRequestDto = (row: schema.DueChangeRequest): DueRequestDto => ({
  id: row.id,
  taskId: row.taskId,
  requestedBy: row.requestedBy,
  newDueDate: row.newDueDate,
  newDueTime: toHhmm(row.newDueTime),
  reason: row.reason,
  state: row.state,
  createdAt: row.createdAt.toISOString(),
})
