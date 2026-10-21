import { z } from 'zod'
import { DEFAULT_PRIORITY, PRIORITIES, TASK_STATUSES } from './types'

const isCalendarDate = (value: string) => {
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export const DateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Ожидается дата YYYY-MM-DD')
  .refine(isCalendarDate, 'Несуществующая дата')

export const TimeString = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Ожидается время HH:mm')

const Id = z.string().min(1)
const Title = z.string().trim().min(1).max(200)
const Description = z.string().max(10000)

export const CreateTaskInput = z.object({
  title: Title,
  description: Description.default(''),
  responsibleId: Id,
  coexecutorIds: z.array(Id).default([]),
  priority: z.enum(PRIORITIES).default(DEFAULT_PRIORITY),
  dueDate: DateString,
  dueTime: TimeString.optional(),
  startDate: DateString.optional(),
  requiresDocument: z.boolean().default(false),
  parentId: Id.optional(),
})
export type CreateTaskInput = z.infer<typeof CreateTaskInput>

// No defaults here: an absent field means "leave unchanged", null clears an optional one.
export const UpdateTaskInput = z.object({
  title: Title.optional(),
  description: Description.optional(),
  responsibleId: Id.optional(),
  priority: z.enum(PRIORITIES).optional(),
  dueDate: DateString.optional(),
  dueTime: TimeString.nullable().optional(),
  startDate: DateString.nullable().optional(),
  requiresDocument: z.boolean().optional(),
})
export type UpdateTaskInput = z.infer<typeof UpdateTaskInput>

export const TransitionInput = z.object({
  to: z.enum(TASK_STATUSES),
  comment: z.string().max(10000).optional(),
  cancelled: z.boolean().optional(),
})
export type TransitionInput = z.infer<typeof TransitionInput>

export const DueChangeRequestInput = z.object({
  dueDate: DateString,
  dueTime: TimeString.optional(),
  reason: z.string().trim().min(1).max(1000),
})
export type DueChangeRequestInput = z.infer<typeof DueChangeRequestInput>
