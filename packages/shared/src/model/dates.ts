import type { Task } from './types'

/** Europe/Moscow is UTC+3 all year (no DST since 2014). */
const MOSCOW_OFFSET_MS = 3 * 60 * 60 * 1000

/** Moscow wall clock for an instant, independent of the machine timezone. */
export function moscowParts(now: Date): { date: string; time: string } {
  const iso = new Date(now.getTime() + MOSCOW_OFFSET_MS).toISOString()
  return { date: iso.slice(0, 10), time: iso.slice(11, 23) }
}

/**
 * Without dueTime the whole due day is available; with it, the task is overdue
 * from the first moment past that minute.
 */
export function isOverdue(task: Pick<Task, 'status' | 'dueDate' | 'dueTime'>, now: Date): boolean {
  if (task.status === 'done') return false
  const { date, time } = moscowParts(now)
  if (date !== task.dueDate) return date > task.dueDate
  return task.dueTime !== null && time > `${task.dueTime}:00.000`
}

export interface ReminderOffset {
  days: number
  /** Count working days (Mon-Fri) instead of calendar days. */
  workingDaysOnly: boolean
}

/**
 * Default due reminders for the responsible: a week ahead (5 working days),
 * 1 day ahead, and at the moment of overdue. Scheduling lives elsewhere.
 */
export const reminderOffsets: { beforeDays: readonly ReminderOffset[]; atOverdue: boolean } = {
  beforeDays: [
    { days: 5, workingDaysOnly: true },
    { days: 1, workingDaysOnly: false },
  ],
  atOverdue: true,
}
