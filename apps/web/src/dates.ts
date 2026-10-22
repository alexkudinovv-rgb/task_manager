import { moscowParts, type Task } from '@car-city/shared/model'

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
const DAY_MS = 86_400_000

// Calendar dates are YYYY-MM-DD strings; arithmetic runs in UTC so the machine timezone never leaks in.
const parseIsoDate = (iso: string) => new Date(`${iso}T00:00:00Z`)

/** Today's date in Moscow, where all deadlines live. */
export function moscowToday(now: Date = new Date()): string {
  return moscowParts(now).date
}

export function shiftIsoDate(iso: string, days: number): string {
  const date = parseIsoDate(iso)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((parseIsoDate(toIso).getTime() - parseIsoDate(fromIso).getTime()) / DAY_MS)
}

/** Russian plural form: plural(2, ['день', 'дня', 'дней']) → 'дня'. */
export function plural(n: number, [one, few, many]: [string, string, string]): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

/** "20 окт". */
export function formatDay(iso: string): string {
  const date = parseIsoDate(iso.slice(0, 10))
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`
}

/**
 * "Сегодня, 18:00", "Завтра", "30 окт", "18 окт · −2 дня". Cards show the time only for today and
 * tomorrow; `withTime` (the task panel) shows it for any day: "30 окт, 15:30".
 */
export function formatDue(task: Pick<Task, 'dueDate' | 'dueTime'>, today: string, overdue: boolean, withTime = false): string {
  const diff = daysBetween(today, task.dueDate)
  const time = task.dueTime ? `, ${task.dueTime}` : ''
  if (diff === 0) return `Сегодня${time}`
  if (diff === 1) return `Завтра${time}`
  const label = `${formatDay(task.dueDate)}${withTime ? time : ''}`
  return overdue ? `${label} · −${-diff} ${plural(-diff, ['день', 'дня', 'дней'])}` : label
}
