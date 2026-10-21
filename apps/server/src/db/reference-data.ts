import type { Db } from './client'
import {
  notificationDefaults,
  positions,
  units,
  type NotificationChannel,
  type NotificationMode,
} from './schema'

export const STARTER_POSITIONS = [
  'Операционный директор',
  'Директор ИТ',
  'Главный бухгалтер',
  'HR-директор',
  'Директор по маркетингу',
  'Руководитель проката',
  'Руководитель таксопарка',
  'Руководитель выкупа',
  'Руководитель технического отдела',
] as const

export const STARTER_UNITS = [
  'Прокат',
  'Таксопарк',
  'Выкуп',
  'Технический отдел',
  'Маркетинг',
  'ИТ',
  'Бухгалтерия',
  'HR',
  'Операционное управление',
] as const

/** Notification events and how they are delivered by default (in-app + push). */
export const DEFAULT_EVENT_MODES = {
  task_reopened: 'instant',
  task_overdue: 'instant',
  hot_set: 'instant',
  due_reminder: 'instant',
  due_change_decided: 'instant',
  task_created: 'digest',
  task_completed: 'digest',
  task_cancelled: 'digest',
  due_changed: 'digest',
  due_change_requested: 'digest',
} as const satisfies Record<string, NotificationMode>

export type NotificationEvent = keyof typeof DEFAULT_EVENT_MODES

export function defaultNotificationRows() {
  const rows: { event: string; channel: NotificationChannel; mode: NotificationMode }[] = []
  for (const [event, mode] of Object.entries(DEFAULT_EVENT_MODES)) {
    rows.push({ event, channel: 'in_app', mode })
    rows.push({ event, channel: 'push', mode })
    // Telegram is opt-in per user.
    rows.push({ event, channel: 'telegram', mode: 'off' })
  }
  return rows
}

/**
 * Idempotent: inserts missing rows only, never overwrites what admins changed
 * in settings (renamed/reordered entries or edited defaults stay as they are).
 */
export async function seedReferenceData(db: Db) {
  return db.transaction(async (tx) => {
    const p = await tx
      .insert(positions)
      .values(STARTER_POSITIONS.map((name, i) => ({ name, sort: (i + 1) * 10 })))
      .onConflictDoNothing({ target: positions.name })
      .returning({ id: positions.id })
    const u = await tx
      .insert(units)
      .values(STARTER_UNITS.map((name, i) => ({ name, sort: (i + 1) * 10 })))
      .onConflictDoNothing({ target: units.name })
      .returning({ id: units.id })
    const n = await tx
      .insert(notificationDefaults)
      .values(defaultNotificationRows())
      .onConflictDoNothing()
      .returning({ event: notificationDefaults.event })
    return { positions: p.length, units: u.length, notificationDefaults: n.length }
  })
}
