import { checkHotLimit, type Priority, type Task, type TaskStatus } from '@car-city/shared/model'
import { moscowToday, shiftIsoDate } from '../dates'
import type { DirectoryItem, TaskApi, User } from './index'

// Fictional people and tasks. No real data on the test site.

const positions: DirectoryItem[] = [
  { id: 'ops-director', name: 'Операционный директор' },
  { id: 'it-director', name: 'Директор ИТ' },
  { id: 'chief-accountant', name: 'Главный бухгалтер' },
  { id: 'hr-director', name: 'HR-директор' },
  { id: 'marketing-director', name: 'Директор по маркетингу' },
  { id: 'rent-head', name: 'Руководитель проката' },
  { id: 'taxi-head', name: 'Руководитель таксопарка' },
  { id: 'buyout-head', name: 'Руководитель выкупа' },
  { id: 'tech-head', name: 'Руководитель технического отдела' },
]

const units: DirectoryItem[] = [
  { id: 'rent', name: 'Прокат' },
  { id: 'taxi', name: 'Таксопарк' },
  { id: 'buyout', name: 'Выкуп' },
  { id: 'tech', name: 'Технический отдел' },
  { id: 'marketing', name: 'Маркетинг' },
  { id: 'it', name: 'ИТ' },
  { id: 'accounting', name: 'Бухгалтерия' },
  { id: 'hr', name: 'HR' },
  { id: 'ops', name: 'Операционное управление' },
]

const director = (id: string, firstName: string, lastName: string, positionId: string, unitId: string): User => ({
  id,
  firstName,
  lastName,
  role: 'director',
  positionId,
  unitId,
})

const users: User[] = [
  { id: 'owner', firstName: 'Собственник', lastName: '', role: 'owner', positionId: null, unitId: null },
  director('belova', 'Анна', 'Белова', 'rent-head', 'rent'),
  director('kovalev', 'Илья', 'Ковалёв', 'taxi-head', 'taxi'),
  director('morozov', 'Дмитрий', 'Морозов', 'buyout-head', 'buyout'),
  director('zaitseva', 'Ольга', 'Зайцева', 'marketing-director', 'marketing'),
  director('lebedev', 'Сергей', 'Лебедев', 'tech-head', 'tech'),
  director('orlova', 'Марина', 'Орлова', 'hr-director', 'hr'),
]

interface Seed {
  id: string
  title: string
  description?: string
  author: string
  responsible: string
  coexecutors?: string[]
  status: TaskStatus
  priority?: Priority
  /** Days from today. */
  due: number
  time?: string
  createdAgo: number
  doneAgo?: number
  parentId?: string
  checklist?: [done: number, total: number]
  subtasks?: [done: number, total: number]
  comments?: number
  requiresDocument?: boolean
  cancelled?: boolean
}

// At most one open hot task per responsible: belova, kovalev, morozov have one each.
const seeds: Seed[] = [
  {
    id: 'T-101',
    title: 'Продлить ОСАГО на Kia Rio х783ое',
    description: 'Полис истекает сегодня вечером, без него машину нельзя выпускать на линию.',
    author: 'owner',
    responsible: 'belova',
    status: 'in_progress',
    priority: 'hot',
    due: 0,
    time: '18:00',
    createdAgo: 3,
    checklist: [2, 4],
    comments: 6,
  },
  {
    id: 'T-102',
    title: 'Обзвонить водителей без выходов на неделе',
    author: 'owner',
    responsible: 'kovalev',
    coexecutors: ['orlova'],
    status: 'in_progress',
    priority: 'hot',
    due: 1,
    createdAgo: 2,
    checklist: [12, 30],
    comments: 3,
  },
  {
    id: 'T-103',
    title: 'Расчёт скидки для новых водителей',
    author: 'owner',
    responsible: 'morozov',
    coexecutors: ['kovalev'],
    status: 'in_progress',
    priority: 'hot',
    due: -1,
    createdAgo: 6,
    checklist: [2, 3],
    comments: 5,
  },
  {
    id: 'T-104',
    title: 'Сверка платежей по выкупу за сентябрь',
    description: 'Приложить подписанный акт сверки — без него задачу не закрыть.',
    author: 'owner',
    responsible: 'morozov',
    status: 'in_progress',
    priority: 'high',
    due: -2,
    createdAgo: 9,
    checklist: [3, 5],
    comments: 4,
    requiresDocument: true,
  },
  {
    id: 'T-105',
    title: 'Отчёт по ДТП за третий квартал',
    author: 'owner',
    responsible: 'kovalev',
    status: 'in_progress',
    priority: 'high',
    due: -1,
    createdAgo: 8,
    checklist: [2, 2],
    comments: 2,
  },
  {
    id: 'T-106',
    title: 'Техосмотр Geely Emgrand — 4 машины',
    author: 'owner',
    responsible: 'lebedev',
    status: 'in_progress',
    due: 7,
    createdAgo: 4,
    checklist: [1, 4],
    subtasks: [1, 2],
    comments: 1,
  },
  {
    id: 'T-106-1',
    parentId: 'T-106',
    title: 'Записать две машины на ТО',
    author: 'lebedev',
    responsible: 'lebedev',
    status: 'done',
    due: 2,
    createdAgo: 4,
    doneAgo: 1,
  },
  {
    id: 'T-106-2',
    parentId: 'T-106',
    title: 'Подменные машины на время ТО',
    author: 'lebedev',
    responsible: 'belova',
    status: 'in_progress',
    due: 5,
    createdAgo: 3,
    comments: 2,
  },
  {
    id: 'T-107',
    title: 'Тексты для акции «Первый день бесплатно»',
    author: 'owner',
    responsible: 'zaitseva',
    coexecutors: ['belova'],
    status: 'in_progress',
    due: 4,
    createdAgo: 5,
    checklist: [3, 5],
    comments: 7,
  },
  {
    id: 'T-108',
    title: 'Вёрстка светлой версии сайта',
    author: 'zaitseva',
    responsible: 'zaitseva',
    status: 'in_progress',
    due: 17,
    createdAgo: 12,
    checklist: [6, 10],
    comments: 9,
  },
  {
    id: 'T-109',
    title: 'Найти подрядчика на оклейку 20 машин Комфорт+',
    author: 'belova',
    responsible: 'lebedev',
    coexecutors: ['zaitseva'],
    status: 'new',
    priority: 'high',
    due: 10,
    createdAgo: 1,
    checklist: [0, 3],
    comments: 2,
  },
  {
    id: 'T-110',
    title: 'Обновить договор аренды с правом выкупа',
    author: 'owner',
    responsible: 'morozov',
    status: 'new',
    due: 15,
    createdAgo: 2,
    checklist: [1, 3],
  },
  {
    id: 'T-111',
    title: 'Подготовить сценарий звонка для новых водителей',
    author: 'kovalev',
    responsible: 'orlova',
    status: 'new',
    priority: 'low',
    due: 17,
    createdAgo: 1,
    checklist: [0, 2],
    comments: 1,
  },
  {
    id: 'T-112',
    title: 'Фото Chery Tiggo 4 PRO на фоне класса',
    author: 'owner',
    responsible: 'zaitseva',
    status: 'new',
    priority: 'low',
    due: 19,
    createdAgo: 0,
  },
  {
    id: 'T-113',
    title: 'Собрать заявки на обучение водителей',
    author: 'orlova',
    responsible: 'kovalev',
    status: 'new',
    due: 9,
    createdAgo: 1,
  },
  {
    id: 'T-114',
    title: 'Анкета сотрудников по таск-трекеру',
    author: 'owner',
    responsible: 'orlova',
    status: 'done',
    due: -5,
    createdAgo: 14,
    doneAgo: 4,
    checklist: [5, 5],
    comments: 11,
  },
  {
    id: 'T-115',
    title: 'Чистка и ТО — партия Экономов',
    author: 'belova',
    responsible: 'lebedev',
    status: 'done',
    due: -4,
    createdAgo: 10,
    doneAgo: 3,
    checklist: [8, 8],
    comments: 2,
  },
  {
    id: 'T-116',
    title: 'Проверка СБ — 6 кандидатов',
    author: 'kovalev',
    responsible: 'orlova',
    status: 'done',
    due: -3,
    createdAgo: 7,
    doneAgo: 2,
    checklist: [6, 6],
    comments: 3,
  },
  {
    id: 'T-117',
    title: 'Новая таблица цен по графикам 7/0, 6/1, 5/2',
    description: 'Отменена: цены остаются прежними до конца года.',
    author: 'owner',
    responsible: 'zaitseva',
    status: 'done',
    due: 2,
    createdAgo: 11,
    doneAgo: 1,
    comments: 4,
    cancelled: true,
  },
]

function buildTask(seed: Seed, today: string): Task {
  const at = (daysAgo: number) => `${shiftIsoDate(today, -daysAgo)}T07:00:00.000Z`
  const [checkDone, checkTotal] = seed.checklist ?? [0, 0]
  const [subDone, subTotal] = seed.subtasks ?? [0, 0]
  return {
    id: seed.id,
    parentId: seed.parentId ?? null,
    title: seed.title,
    description: seed.description ?? '',
    authorId: seed.author,
    responsibleId: seed.responsible,
    coexecutorIds: seed.coexecutors ?? [],
    status: seed.status,
    priority: seed.priority ?? 'medium',
    dueDate: shiftIsoDate(today, seed.due),
    dueTime: seed.time ?? null,
    startDate: null,
    requiresDocument: seed.requiresDocument ?? false,
    cancelled: seed.cancelled ?? false,
    createdAt: at(seed.createdAgo),
    completedAt: seed.doneAgo === undefined ? null : at(seed.doneAgo),
    attachmentCount: 0,
    checklist: { done: checkDone, total: checkTotal },
    subtasks: { done: subDone, total: subTotal },
    commentCount: seed.comments ?? 0,
  }
}

/** Guards the demo data against breaking the one-hot-task rule when someone edits the seeds. */
function assertHotLimit(tasks: Task[]): void {
  const openHot = tasks.filter((task) => task.priority === 'hot' && task.status !== 'done')
  for (const task of openHot) {
    const sameResponsible = openHot.filter((t) => t.responsibleId === task.responsibleId).map((t) => t.id)
    if (!checkHotLimit(sameResponsible, task.id).ok) throw new Error(`Hot limit broken by ${task.id}`)
  }
}

export const mockApi: TaskApi = {
  async loadWorkspace() {
    // Dates are relative to today so overdue/hot cases always look realistic.
    const today = moscowToday()
    const tasks = seeds.map((seed) => buildTask(seed, today))
    if (import.meta.env.DEV) assertHotLimit(tasks)
    return { users, positions, units, tasks }
  },
}
