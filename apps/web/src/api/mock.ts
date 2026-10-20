import { shiftIsoDate, toIsoDate } from '../dates'
import type { Department, Status, Task, User } from '../domain'
import type { TaskApi } from './index'

// Fictional people and tasks from the Claude Design variants. No real data on the test site.

const statuses: Status[] = [
  { id: 'new', title: 'Новые', tone: 'slate', isFinal: false },
  { id: 'progress', title: 'В работе', tone: 'blue', isFinal: false },
  { id: 'review', title: 'На проверке', tone: 'violet', isFinal: false },
  { id: 'paused', title: 'Отложена', tone: 'sand', isFinal: false },
  { id: 'done', title: 'Готово', tone: 'green', isFinal: true },
]

const users: User[] = [
  { id: 'belova', name: 'Анна Белова' },
  { id: 'kovalev', name: 'Илья Ковалёв' },
  { id: 'morozov', name: 'Дмитрий Морозов' },
  { id: 'zaitseva', name: 'Ольга Зайцева' },
  { id: 'lebedev', name: 'Сергей Лебедев' },
  { id: 'orlova', name: 'Марина Орлова' },
]

const departments: Department[] = [
  { id: 'fleet', name: 'Автопарк', leadId: 'belova' },
  { id: 'drivers', name: 'Водители', leadId: 'kovalev' },
  { id: 'buyout', name: 'Выкуп и финансы', leadId: 'morozov' },
  { id: 'marketing', name: 'Маркетинг', leadId: 'zaitseva' },
  { id: 'office', name: 'Офис', leadId: 'zaitseva' },
]

type Seed = [
  title: string,
  departmentId: string,
  statusId: string,
  assigneeId: string,
  dueInDays: number,
  subtasks: [done: number, total: number],
  comments: number,
  extra?: { hot?: boolean; time?: string },
]

const seeds: Seed[] = [
  ['Найти подрядчика на оклейку 20 машин Комфорт+', 'fleet', 'new', 'belova', 10, [0, 3], 2],
  ['Обновить договор аренды с правом выкупа', 'buyout', 'paused', 'morozov', 15, [1, 3], 0],
  ['Подготовить сценарий звонка для новых водителей', 'drivers', 'new', 'orlova', 17, [0, 2], 1],
  ['Фото Chery Tiggo 4 PRO на фоне класса', 'marketing', 'new', 'zaitseva', 19, [0, 0], 0],
  ['Продлить ОСАГО на Kia Rio х783ое', 'fleet', 'progress', 'belova', 0, [2, 4], 6, { hot: true, time: '18:00' }],
  ['Сверка платежей по выкупу за сентябрь', 'buyout', 'progress', 'morozov', -2, [3, 5], 4],
  ['Обзвонить водителей без выходов на неделе', 'drivers', 'progress', 'kovalev', 1, [12, 30], 3, { hot: true }],
  ['Вёрстка светлой версии сайта', 'marketing', 'progress', 'zaitseva', 17, [6, 10], 9],
  ['Техосмотр Geely Emgrand — 4 машины', 'fleet', 'progress', 'lebedev', 7, [1, 4], 1],
  ['Расчёт скидки для новых водителей', 'buyout', 'review', 'morozov', 2, [4, 4], 5, { hot: true }],
  ['Отчёт по ДТП за третий квартал', 'drivers', 'review', 'kovalev', -1, [2, 2], 2],
  ['Тексты для акции «Первый день бесплатно»', 'marketing', 'review', 'zaitseva', 4, [3, 3], 7],
  ['Анкета сотрудников по таск-трекеру', 'office', 'done', 'zaitseva', -5, [5, 5], 11],
  ['Чистка и ТО — партия Экономов', 'fleet', 'done', 'lebedev', -4, [8, 8], 2],
  ['Проверка СБ — 6 кандидатов', 'drivers', 'done', 'kovalev', -3, [6, 6], 3],
  ['Новая таблица цен по графикам 7/0, 6/1, 5/2', 'marketing', 'done', 'zaitseva', -6, [0, 0], 4],
]

function buildTasks(today: string): Task[] {
  return seeds.map(([title, departmentId, statusId, assigneeId, dueInDays, [done, total], comments, extra], i) => ({
    id: `T-${101 + i}`,
    title,
    departmentId,
    statusId,
    assigneeId,
    dueDate: shiftIsoDate(today, dueInDays),
    dueTime: extra?.time,
    isHot: extra?.hot ?? false,
    subtasks: { done, total },
    comments,
  }))
}

export const mockApi: TaskApi = {
  async loadWorkspace() {
    // Dates are relative to today so overdue/hot cases always look realistic.
    const today = toIsoDate(new Date())
    return { statuses, departments, users, tasks: buildTasks(today) }
  },
}
