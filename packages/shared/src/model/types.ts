export type Role = 'owner' | 'director'

export interface Actor {
  id: string
  role: Role
}

/** Fixed set, not configurable (see docs/requirements.md). */
export const TASK_STATUSES = ['new', 'in_progress', 'done'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  new: 'Новая',
  in_progress: 'В работе',
  done: 'Завершена',
}

export const PRIORITIES = ['low', 'medium', 'high', 'hot'] as const
export type Priority = (typeof PRIORITIES)[number]

export const DEFAULT_PRIORITY: Priority = 'medium'

export const PRIORITY_LABELS: Record<Priority, string> = {
  low: 'Низкий',
  medium: 'Средний',
  high: 'Высокий',
  hot: 'Горит',
}

export interface Counter {
  done: number
  total: number
}

export interface Task {
  id: string
  /** Set for subtasks; subtasks are one level deep only. */
  parentId: string | null
  title: string
  description: string
  authorId: string
  responsibleId: string
  coexecutorIds: string[]
  status: TaskStatus
  priority: Priority
  /** Moscow date, YYYY-MM-DD. */
  dueDate: string
  /** Moscow time, HH:mm; null when only the day matters. */
  dueTime: string | null
  startDate: string | null
  requiresDocument: boolean
  /** Only meaningful with status 'done': closed as unnecessary. */
  cancelled: boolean
  /** ISO timestamp. */
  createdAt: string
  completedAt: string | null
  attachmentCount: number
  checklist: Counter
  subtasks: Counter
  commentCount: number
}

export const TASK_EVENTS = [
  'task_created',
  'task_started',
  'task_completed',
  'task_cancelled',
  'task_reopened',
  'due_changed',
  'due_change_requested',
  'due_change_decided',
  'due_reminder',
  'hot_set',
  'task_overdue',
  // History only: written by the server, never notify anyone.
  'task_updated',
  'coexecutors_changed',
  'checklist_item_added',
  'checklist_item_updated',
  'checklist_item_removed',
] as const
export type TaskEvent = (typeof TASK_EVENTS)[number]
