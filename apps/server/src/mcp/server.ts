import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import {
  type FakeTaskStore,
  isRealIsoDate,
  PRIORITY_LABELS,
  STATUS_LABELS,
  type Task,
  TASK_PRIORITIES,
  TASK_STATUSES,
} from './fake-store'

const INSTRUCTIONS = [
  'Это трекер задач автосалона Car City (сейчас тестовые данные, не реальные).',
  'Отвечай пользователю по-русски.',
  'Никогда не придумывай ответственного и срок задачи. Если пользователь их не назвал — сначала спроси его.',
].join(' ')

const NEVER_INVENT =
  'Никогда не подставляй значение сам: если пользователь его не назвал явно, сначала спроси пользователя.'

function ok(text: string, structuredContent: Record<string, unknown>): CallToolResult {
  return { content: [{ type: 'text', text }], structuredContent }
}

function fail(text: string, structuredContent: Record<string, unknown> = {}): CallToolResult {
  return { content: [{ type: 'text', text }], structuredContent, isError: true }
}

function describeTask(store: FakeTaskStore, task: Task): string {
  const due = task.dueTime ? `${task.dueDate} ${task.dueTime}` : task.dueDate
  const overdue = store.isOverdue(task) ? ', ПРОСРОЧЕНА' : ''
  return (
    `#${task.id} «${task.title}» — ${task.responsible}, срок ${due}, ` +
    `статус: ${STATUS_LABELS[task.status]}, приоритет: ${PRIORITY_LABELS[task.priority]}${overdue}`
  )
}

function toDto(store: FakeTaskStore, task: Task) {
  return {
    id: task.id,
    title: task.title,
    description: task.description ?? null,
    responsible: task.responsible,
    status: task.status,
    priority: task.priority,
    due_date: task.dueDate,
    due_time: task.dueTime ?? null,
    overdue: store.isOverdue(task),
    comments: task.comments.map((c) => ({ text: c.text, created_at: c.createdAt })),
  }
}

function resolvePerson(store: FakeTaskStore, input: string): { name: string } | { error: CallToolResult } {
  const match = store.resolvePerson(input)
  if (match.ok) return { name: match.name }
  const list = match.candidates.join(', ')
  const text =
    match.reason === 'ambiguous'
      ? `Имя «${input}» подходит нескольким сотрудникам: ${list}. Уточните у пользователя, кого он имеет в виду.`
      : `Сотрудник «${input}» не найден. Доступные сотрудники: ${list}. Спросите у пользователя, кого назначить.`
  return { error: fail(text, { error: `${match.reason}_responsible`, valid_responsibles: match.candidates }) }
}

function taskNotFound(id: number): CallToolResult {
  return fail(`Задача #${id} не найдена. Посмотрите список задач через list_tasks.`, { error: 'task_not_found' })
}

const taskId = z.number().int().positive().describe('Номер задачи (id из list_tasks)')

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isRealIsoDate, 'Несуществующая дата')

/** One server per request (stateless transport); all of them share the same store. */
export function createMcpServer(store: FakeTaskStore): McpServer {
  const server = new McpServer({ name: 'car-city-tasks', version: '0.1.0' }, { instructions: INSTRUCTIONS })

  server.registerTool(
    'list_tasks',
    {
      title: 'Список задач',
      description: 'Показывает задачи. Можно отфильтровать по ответственному, статусу и только просроченные.',
      inputSchema: {
        responsible: z.string().min(1).optional().describe('Имя ответственного сотрудника (полное или только имя)'),
        status: z.enum(TASK_STATUSES).optional().describe('new — новая, in_progress — в работе, done — выполнена'),
        only_overdue: z.boolean().optional().describe('true — только просроченные невыполненные задачи'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ responsible, status, only_overdue }) => {
      let person: string | undefined
      if (responsible) {
        const resolved = resolvePerson(store, responsible)
        if ('error' in resolved) return resolved.error
        person = resolved.name
      }
      const tasks = store.list({ responsible: person, status, onlyOverdue: only_overdue })
      const text = tasks.length
        ? `Найдено задач: ${tasks.length}\n${tasks.map((t) => describeTask(store, t)).join('\n')}`
        : 'Задач по этим условиям нет.'
      return ok(text, { tasks: tasks.map((t) => toDto(store, t)) })
    },
  )

  server.registerTool(
    'create_task',
    {
      title: 'Создать задачу',
      description:
        'Создаёт задачу. Ответственный и срок обязательны и должны прийти от пользователя: ' +
        'никогда не придумывай их и не подставляй «по умолчанию». ' +
        'Если пользователь не назвал ответственного или срок — сначала спроси его и только потом вызывай инструмент. ' +
        'Если инструмент вернул ошибку про неизвестного сотрудника — покажи пользователю список и спроси, кого назначить.',
      inputSchema: {
        title: z.string().trim().min(3).max(200).describe('Краткая формулировка задачи'),
        responsible: z.string().trim().min(1).describe(`Имя ответственного сотрудника, названное пользователем. ${NEVER_INVENT}`),
        due_date: isoDate.describe(`Срок в формате YYYY-MM-DD, названный пользователем. ${NEVER_INVENT}`),
        due_time: z
          .string()
          .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
          .optional()
          .describe('Время срока HH:MM, только если пользователь его назвал'),
        priority: z
          .enum(TASK_PRIORITIES)
          .optional()
          .describe('low — низкий, medium — средний (по умолчанию), high — высокий, hot — горящий'),
        description: z.string().max(2000).optional().describe('Подробности, если пользователь их дал'),
      },
    },
    async ({ title, responsible, due_date, due_time, priority, description }) => {
      const resolved = resolvePerson(store, responsible)
      if ('error' in resolved) return resolved.error
      const task = store.create({
        title,
        responsible: resolved.name,
        dueDate: due_date,
        dueTime: due_time,
        priority,
        description,
      })
      return ok(`Задача создана: ${describeTask(store, task)}`, { task: toDto(store, task) })
    },
  )

  server.registerTool(
    'change_status',
    {
      title: 'Сменить статус задачи',
      description: 'Меняет статус задачи: new — новая, in_progress — в работе, done — выполнена. Можно добавить комментарий.',
      inputSchema: {
        task_id: taskId,
        status: z.enum(TASK_STATUSES).describe('Новый статус'),
        comment: z.string().trim().min(1).max(2000).optional().describe('Комментарий к смене статуса'),
      },
      annotations: { idempotentHint: true },
    },
    async ({ task_id, status, comment }) => {
      const task = store.get(task_id)
      if (!task) return taskNotFound(task_id)
      const previous = task.status
      task.status = status
      if (comment) store.addComment(task, comment)
      return ok(
        `Статус задачи #${task.id} изменён: ${STATUS_LABELS[previous]} → ${STATUS_LABELS[status]}.`,
        { task: toDto(store, task) },
      )
    },
  )

  server.registerTool(
    'add_comment',
    {
      title: 'Добавить комментарий',
      description: 'Добавляет комментарий к задаче.',
      inputSchema: {
        task_id: taskId,
        text: z.string().trim().min(1).max(2000).describe('Текст комментария'),
      },
    },
    async ({ task_id, text }) => {
      const task = store.get(task_id)
      if (!task) return taskNotFound(task_id)
      store.addComment(task, text)
      return ok(`Комментарий добавлен к задаче #${task.id} «${task.title}».`, { task: toDto(store, task) })
    },
  )

  server.registerTool(
    'who_is_busy',
    {
      title: 'Кто чем занят',
      description: 'Показывает, сколько открытых (не выполненных) задач у каждого сотрудника и сколько из них просрочено.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const people = store.workload().sort((a, b) => b.open - a.open)
      const lines = people.map(
        (p) => `${p.name}: открытых задач ${p.open}${p.overdue ? `, из них просрочено ${p.overdue}` : ''}`,
      )
      return ok(`Загрузка сотрудников:\n${lines.join('\n')}`, { people })
    },
  )

  return server
}
