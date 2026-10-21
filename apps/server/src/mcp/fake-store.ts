// In-memory sample data for the MCP spike. Not real people or tasks; replaced by the DB later.

export const TASK_STATUSES = ['new', 'in_progress', 'done'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

export const TASK_PRIORITIES = ['low', 'medium', 'high', 'hot'] as const
export type TaskPriority = (typeof TASK_PRIORITIES)[number]

export const STATUS_LABELS: Record<TaskStatus, string> = {
  new: 'Новая',
  in_progress: 'В работе',
  done: 'Выполнена',
}

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: 'Низкий',
  medium: 'Средний',
  high: 'Высокий',
  hot: 'Горящий',
}

export const FAKE_PEOPLE = ['Иван Петров', 'Мария Смирнова', 'Алексей Кузнецов', 'Ольга Соколова'] as const

export interface TaskComment {
  text: string
  createdAt: string
}

export interface Task {
  id: number
  title: string
  description?: string
  responsible: string
  status: TaskStatus
  priority: TaskPriority
  dueDate: string
  dueTime?: string
  comments: TaskComment[]
}

export interface NewTask {
  title: string
  responsible: string
  dueDate: string
  dueTime?: string
  priority?: TaskPriority
  description?: string
}

export interface TaskFilter {
  responsible?: string
  status?: TaskStatus
  onlyOverdue?: boolean
}

export type PersonMatch =
  | { ok: true; name: string }
  | { ok: false; reason: 'unknown' | 'ambiguous'; candidates: string[] }

/** Local calendar date as YYYY-MM-DD. */
export function toIsoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function isRealIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d
}

function shiftDays(base: Date, days: number): string {
  const date = new Date(base)
  date.setDate(date.getDate() + days)
  return toIsoDate(date)
}

export class FakeTaskStore {
  private readonly tasks: Task[]
  private nextId: number

  constructor(private readonly now: () => Date = () => new Date()) {
    const today = now()
    // Dates are relative to today so there is always something overdue to show.
    this.tasks = [
      {
        id: 1,
        title: 'Подготовить отчёт по продажам за неделю',
        responsible: 'Мария Смирнова',
        status: 'in_progress',
        priority: 'high',
        dueDate: shiftDays(today, 1),
        dueTime: '18:00',
        comments: [],
      },
      {
        id: 2,
        title: 'Проверить комплектацию автомобиля перед выдачей клиенту',
        responsible: 'Иван Петров',
        status: 'new',
        priority: 'hot',
        dueDate: shiftDays(today, -1),
        dueTime: '10:00',
        comments: [],
      },
      {
        id: 3,
        title: 'Обзвонить клиентов, записанных на ТО',
        responsible: 'Алексей Кузнецов',
        status: 'new',
        priority: 'medium',
        dueDate: shiftDays(today, 3),
        comments: [],
      },
      {
        id: 4,
        title: 'Обновить прайс-лист на дополнительное оборудование',
        responsible: 'Ольга Соколова',
        status: 'done',
        priority: 'low',
        dueDate: shiftDays(today, -2),
        comments: [{ text: 'Готово, выложено в общую папку', createdAt: today.toISOString() }],
      },
      {
        id: 5,
        title: 'Согласовать график тест-драйвов на выходные',
        description: 'Учесть две машины в сервисе',
        responsible: 'Мария Смирнова',
        status: 'new',
        priority: 'medium',
        dueDate: shiftDays(today, -3),
        comments: [],
      },
    ]
    this.nextId = this.tasks.length + 1
  }

  people(): readonly string[] {
    return FAKE_PEOPLE
  }

  /** Accepts a full name or a unique part of it (e.g. just «Мария»), case-insensitive. */
  resolvePerson(input: string): PersonMatch {
    const needle = input.trim().toLowerCase().replaceAll('ё', 'е')
    const norm = (s: string) => s.toLowerCase().replaceAll('ё', 'е')
    if (!needle) return { ok: false, reason: 'unknown', candidates: [...FAKE_PEOPLE] }
    const exact = FAKE_PEOPLE.find((p) => norm(p) === needle)
    if (exact) return { ok: true, name: exact }
    const partial = FAKE_PEOPLE.filter((p) => norm(p).split(' ').includes(needle))
    if (partial.length === 1) return { ok: true, name: partial[0] }
    if (partial.length > 1) return { ok: false, reason: 'ambiguous', candidates: partial }
    return { ok: false, reason: 'unknown', candidates: [...FAKE_PEOPLE] }
  }

  isOverdue(task: Task): boolean {
    return task.status !== 'done' && task.dueDate < toIsoDate(this.now())
  }

  list(filter: TaskFilter = {}): Task[] {
    return this.tasks.filter(
      (t) =>
        (!filter.responsible || t.responsible === filter.responsible) &&
        (!filter.status || t.status === filter.status) &&
        (!filter.onlyOverdue || this.isOverdue(t)),
    )
  }

  get(id: number): Task | undefined {
    return this.tasks.find((t) => t.id === id)
  }

  create(input: NewTask): Task {
    const task: Task = {
      id: this.nextId++,
      title: input.title,
      description: input.description,
      responsible: input.responsible,
      status: 'new',
      priority: input.priority ?? 'medium',
      dueDate: input.dueDate,
      dueTime: input.dueTime,
      comments: [],
    }
    this.tasks.push(task)
    return task
  }

  addComment(task: Task, text: string): void {
    task.comments.push({ text, createdAt: this.now().toISOString() })
  }

  workload(): { name: string; open: number; overdue: number }[] {
    return FAKE_PEOPLE.map((name) => {
      const open = this.tasks.filter((t) => t.responsible === name && t.status !== 'done')
      return { name, open: open.length, overdue: open.filter((t) => this.isOverdue(t)).length }
    })
  }
}
