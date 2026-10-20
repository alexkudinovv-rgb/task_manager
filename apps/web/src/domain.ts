/** Pastel pair from the Car City class palette; statuses reuse it. */
export type Tone = 'slate' | 'blue' | 'violet' | 'sand' | 'green'

/** Statuses are data, not code: the owner's questionnaire decides the final set. */
export interface Status {
  id: string
  title: string
  tone: Tone
  isFinal: boolean
}

export interface Department {
  id: string
  name: string
  leadId: string
}

export interface User {
  id: string
  name: string
}

export interface Task {
  id: string
  title: string
  departmentId: string
  statusId: string
  assigneeId: string
  /** Local date, YYYY-MM-DD. */
  dueDate: string
  /** Local time, HH:mm; absent when only the day matters. */
  dueTime?: string
  isHot: boolean
  subtasks: { done: number; total: number }
  comments: number
}

export function initials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

export function isOverdue(task: Task, status: Status, today: string): boolean {
  return !status.isFinal && task.dueDate < today
}
