import { useState, type FormEvent } from 'react'
import {
  DEFAULT_PRIORITY,
  PRIORITIES,
  PRIORITY_LABELS,
  type CreateTaskInput,
  type Priority,
  type Task,
  type UpdateTaskInput,
  type UserDto,
} from '@car-city/shared/model'
import { FormError } from '../api/errors'
import { moscowToday } from '../dates'
import { activeUsers, fullName, type Lookup } from '../workspace'
import { ErrorNote, Field, useAction } from './ui'

export interface TaskFormValues {
  title: string
  description: string
  responsibleId: string
  coexecutorIds: string[]
  priority: Priority
  /** YYYY-MM-DD, Moscow. */
  dueDate: string
  /** HH:mm, or '' when only the day matters. */
  dueTime: string
  requiresDocument: boolean
}

export function newTaskValues(responsibleId: string): TaskFormValues {
  return {
    title: '',
    description: '',
    responsibleId,
    coexecutorIds: [],
    priority: DEFAULT_PRIORITY,
    dueDate: moscowToday(),
    dueTime: '',
    requiresDocument: false,
  }
}

export function taskValues(task: Task): TaskFormValues {
  return {
    title: task.title,
    description: task.description,
    responsibleId: task.responsibleId,
    coexecutorIds: task.coexecutorIds,
    priority: task.priority,
    dueDate: task.dueDate,
    dueTime: task.dueTime ?? '',
    requiresDocument: task.requiresDocument,
  }
}

/** Body for POST /api/tasks; `parentId` makes it a subtask. */
export function toCreateInput(values: TaskFormValues, parentId?: string): CreateTaskInput {
  return {
    title: values.title,
    description: values.description,
    responsibleId: values.responsibleId,
    coexecutorIds: values.coexecutorIds,
    priority: values.priority,
    dueDate: values.dueDate,
    ...(values.dueTime ? { dueTime: values.dueTime } : {}),
    requiresDocument: values.requiresDocument,
    ...(parentId ? { parentId } : {}),
  }
}

/** Body for PATCH /api/tasks/:id: only the fields that changed. Coexecutors go through PUT /coexecutors. */
export function toUpdateInput(before: TaskFormValues, after: TaskFormValues): UpdateTaskInput {
  const patch: UpdateTaskInput = {}
  if (after.title !== before.title) patch.title = after.title
  if (after.description !== before.description) patch.description = after.description
  if (after.responsibleId !== before.responsibleId) patch.responsibleId = after.responsibleId
  if (after.requiresDocument !== before.requiresDocument) patch.requiresDocument = after.requiresDocument
  if (after.dueDate !== before.dueDate) patch.dueDate = after.dueDate
  if (after.dueTime !== before.dueTime) patch.dueTime = after.dueTime || null
  if (after.priority !== before.priority) patch.priority = after.priority
  return patch
}

interface Props {
  initial: TaskFormValues
  lookup: Lookup
  /** Who may be the responsible (policy: canCreateTask / canCreateSubtask). */
  canAssign: (user: UserDto) => boolean
  /** «Горит» is the owner's call. */
  allowHot: boolean
  submitLabel: string
  /** Throws on failure; the error is shown under the form. */
  onSubmit: (values: TaskFormValues) => Promise<void>
  onCancel?: () => void
  onOpenTask?: (id: string) => void
}

export function TaskForm({ initial, lookup, canAssign, allowHot, submitLabel, onSubmit, onCancel, onOpenTask }: Props) {
  const [values, setValues] = useState(initial)
  const action = useAction()
  const set = <K extends keyof TaskFormValues>(key: K, value: TaskFormValues[K]) => setValues((v) => ({ ...v, [key]: value }))

  const people = activeUsers(lookup)
  const responsibleOptions = people.filter((user) => canAssign(user) || user.id === initial.responsibleId)
  const current = lookup.users.get(initial.responsibleId)
  if (current && !responsibleOptions.includes(current)) responsibleOptions.unshift(current)
  const coexecutorOptions = people.filter((user) => user.id !== values.responsibleId)
  const priorities = PRIORITIES.filter((p) => p !== 'hot' || allowHot || initial.priority === 'hot')

  function toggleCoexecutor(id: string, on: boolean) {
    set('coexecutorIds', on ? [...values.coexecutorIds, id] : values.coexecutorIds.filter((other) => other !== id))
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    void action.run(async () => {
      if (!values.title.trim()) throw new FormError('Введите название задачи.')
      if (!values.responsibleId) throw new FormError('Выберите ответственного.')
      if (!values.dueDate) throw new FormError('Укажите срок — дата обязательна.')
      await onSubmit({
        ...values,
        title: values.title.trim(),
        coexecutorIds: values.coexecutorIds.filter((id) => id !== values.responsibleId),
      })
    })
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <Field label="Название">
        <input className="input" maxLength={200} value={values.title} onChange={(e) => set('title', e.target.value)} />
      </Field>
      <Field label="Описание">
        <textarea
          className="input textarea"
          rows={3}
          maxLength={10000}
          value={values.description}
          onChange={(e) => set('description', e.target.value)}
        />
      </Field>
      <Field label="Ответственный">
        <select className="input" value={values.responsibleId} onChange={(e) => set('responsibleId', e.target.value)}>
          {!values.responsibleId && <option value="">Выберите</option>}
          {responsibleOptions.map((user) => (
            <option key={user.id} value={user.id}>
              {fullName(user)}
            </option>
          ))}
        </select>
      </Field>
      {coexecutorOptions.length > 0 && (
        <fieldset className="field checks">
          <legend className="field-label">Соисполнители</legend>
          {coexecutorOptions.map((user) => (
            <label key={user.id} className="check-row">
              <input
                type="checkbox"
                checked={values.coexecutorIds.includes(user.id)}
                onChange={(e) => toggleCoexecutor(user.id, e.target.checked)}
              />
              {fullName(user)}
            </label>
          ))}
        </fieldset>
      )}
      <Field label="Приоритет">
        <select className="input" value={values.priority} onChange={(e) => set('priority', e.target.value as Priority)}>
          {priorities.map((priority) => (
            <option key={priority} value={priority} disabled={priority === 'hot' && !allowHot}>
              {PRIORITY_LABELS[priority]}
            </option>
          ))}
        </select>
      </Field>
      <div className="field-row">
        <Field label="Срок">
          <input className="input" type="date" required value={values.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
        </Field>
        <Field label="Время (МСК)" hint="Необязательно">
          <input className="input" type="time" value={values.dueTime} onChange={(e) => set('dueTime', e.target.value)} />
        </Field>
      </div>
      <label className="check-row">
        <input
          type="checkbox"
          checked={values.requiresDocument}
          onChange={(e) => set('requiresDocument', e.target.checked)}
        />
        Нужен документ — без вложения задачу не завершить
      </label>
      <ErrorNote error={action.error} lookup={lookup} onOpenTask={onOpenTask} />
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={action.busy}>
          {action.busy ? 'Сохраняем…' : submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Отмена
          </button>
        )}
      </div>
    </form>
  )
}
