import type { Task } from './types'

export interface Progress {
  done: number
  total: number
  /** 0..1; 0 when there is nothing to count. */
  ratio: number
}

/** Computed from subtasks and checklist items; there is no manual percentage. */
export function progress(task: Pick<Task, 'subtasks' | 'checklist'>): Progress {
  const done = task.subtasks.done + task.checklist.done
  const total = task.subtasks.total + task.checklist.total
  return { done, total, ratio: total === 0 ? 0 : done / total }
}
