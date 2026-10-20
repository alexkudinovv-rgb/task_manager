import type { Task } from '@car-city/shared'

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
const DAY_MS = 86_400_000

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function shiftIsoDate(iso: string, days: number): string {
  const date = parseIsoDate(iso)
  date.setDate(date.getDate() + days)
  return toIsoDate(date)
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

/** "Сегодня, 18:00", "Завтра", "30 окт", "18 окт · −2 дня". */
export function formatDue(task: Task, today: string, overdue: boolean): string {
  const diff = daysBetween(today, task.dueDate)
  const time = task.dueTime ? `, ${task.dueTime}` : ''
  if (diff === 0) return `Сегодня${time}`
  if (diff === 1) return `Завтра${time}`
  const date = parseIsoDate(task.dueDate)
  const label = `${date.getDate()} ${MONTHS[date.getMonth()]}`
  return overdue ? `${label} · −${-diff} ${plural(-diff, ['день', 'дня', 'дней'])}` : label
}
