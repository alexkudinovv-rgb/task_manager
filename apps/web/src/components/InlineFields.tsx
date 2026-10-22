import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import {
  PRIORITIES,
  PRIORITY_LABELS,
  canCreateTask,
  type AllowedActions,
  type Priority,
  type Task,
  type UserDto,
} from '@car-city/shared/model'
import { serverApi } from '../api'
import { FormError } from '../api/errors'
import { formatDay, formatDue } from '../dates'
import { activeUsers, byName, fullName, type Lookup, type TaskView } from '../workspace'
import { taskValues, toUpdateInput, type TaskFormValues } from './TaskForm'
import { ErrorNote, useAction } from './ui'

interface Props {
  view: TaskView
  viewer: UserDto
  lookup: Lookup
  /** From GET /api/tasks/:id; absent (demo, still loading) means read-only. */
  allowed?: AllowedActions
  /** Reloads the task and the workspace after a save. */
  refresh?: () => Promise<void>
  onOpenTask: (id: string) => void
}

type FieldKey = 'title' | 'description' | 'responsible' | 'coexecutors' | 'due' | 'priority'

/** Title, description and facts of the task panel; each field the viewer may change opens in place. */
export function TaskSummary({ view, viewer, lookup, allowed, refresh, onOpenTask }: Props) {
  const { task } = view
  const [editing, setEditing] = useState<FieldKey | null>(null)
  const documentAction = useAction()

  const before = taskValues(task)
  async function update(changes: Partial<TaskFormValues>) {
    const after = { ...before, ...changes }
    const patch = toUpdateInput(before, after)
    if (Object.keys(patch).length > 0) await serverApi.updateTask(task.id, patch)
    if (!sameIds(before.coexecutorIds, after.coexecutorIds)) {
      await serverApi.setCoexecutors(task.id, { userIds: after.coexecutorIds })
    }
    await refresh?.()
    setEditing(null)
  }

  const editor = { task, lookup, onOpenTask, update, onCancel: () => setEditing(null) }
  // One field at a time: the pencils hide while an editor is open.
  const start = (key: FieldKey, can: boolean | undefined) => (can && editing === null ? () => setEditing(key) : undefined)
  const responsiblePosition = view.responsible.positionId ? lookup.positions.get(view.responsible.positionId)?.name : null

  return (
    <>
      <div className="panel-title-row" hidden={editing === 'title'}>
        <h2 id="panel-title" className="panel-title">
          {task.title}
        </h2>
        <EditButton label="Название" onClick={start('title', allowed?.edit)} />
      </div>
      {editing === 'title' && <TitleEditor {...editor} />}

      {(task.description || allowed?.edit) && (
        <section className="panel-description">
          <h3 className="mono-label">
            Описание
            <EditButton label="Описание" onClick={start('description', allowed?.edit && Boolean(task.description))} />
          </h3>
          {editing === 'description' ? (
            <DescriptionEditor {...editor} />
          ) : task.description ? (
            <LongText text={task.description} />
          ) : (
            <button type="button" className="link-button" disabled={editing !== null} onClick={() => setEditing('description')}>
              Добавить описание
            </button>
          )}
        </section>
      )}

      <dl className="panel-facts">
        <Fact
          label="Ответственный"
          onEdit={start('responsible', allowed?.edit)}
          editor={editing === 'responsible' ? <ResponsibleEditor {...editor} viewer={viewer} /> : undefined}
        >
          {fullName(view.responsible)}
          {responsiblePosition && <span className="muted"> · {responsiblePosition}</span>}
        </Fact>
        {(view.coexecutors.length > 0 || allowed?.manageCoexecutors) && (
          <Fact
            label="Соисполнители"
            onEdit={start('coexecutors', allowed?.manageCoexecutors)}
            editor={editing === 'coexecutors' ? <CoexecutorsEditor {...editor} /> : undefined}
          >
            {view.coexecutors.length > 0 ? view.coexecutors.map(fullName).join(', ') : '—'}
          </Fact>
        )}
        <Fact label="Постановщик">{fullName(view.author)}</Fact>
        <Fact label="Подразделение">{view.unit?.name ?? '—'}</Fact>
        <Fact label="Срок" onEdit={start('due', allowed?.changeDue)} editor={editing === 'due' ? <DueEditor {...editor} /> : undefined}>
          <span className={`mono due${view.overdue ? ' is-overdue' : ''}`}>{formatDue(task, lookup.today, view.overdue, true)}</span>
        </Fact>
        <Fact
          label="Приоритет"
          onEdit={start('priority', allowed?.setPriority)}
          editor={editing === 'priority' ? <PriorityEditor {...editor} allowHot={allowed?.setHot ?? false} /> : undefined}
        >
          {PRIORITY_LABELS[task.priority]}
        </Fact>
        {(task.requiresDocument || allowed?.edit) && (
          <Fact label="Документ">
            {allowed?.edit ? (
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={task.requiresDocument}
                  disabled={documentAction.busy || editing !== null}
                  onChange={(e) => {
                    const requiresDocument = e.target.checked
                    void documentAction.run(() => update({ requiresDocument }))
                  }}
                />
                <span>
                  Нужен для завершения
                  {task.requiresDocument && <span className="muted"> · {task.attachmentCount > 0 ? 'приложен' : 'пока не приложен'}</span>}
                </span>
              </label>
            ) : task.attachmentCount > 0 ? (
              'Приложен'
            ) : (
              'Нужен, пока не приложен'
            )}
            <ErrorNote error={documentAction.error} />
          </Fact>
        )}
        <Fact label="Создана">{formatDay(task.createdAt)}</Fact>
        {task.completedAt && <Fact label={task.cancelled ? 'Отменена' : 'Завершена'}>{formatDay(task.completedAt)}</Fact>}
        <Fact label="Прогресс">
          подзадачи {task.subtasks.done}/{task.subtasks.total} · чек-лист {task.checklist.done}/{task.checklist.total}
        </Fact>
      </dl>
    </>
  )
}

interface FactProps {
  label: string
  children: ReactNode
  /** Shows the pencil next to the value. */
  onEdit?: () => void
  /** Replaces the value while the field is open. */
  editor?: ReactNode
}

function Fact({ label, children, onEdit, editor }: FactProps) {
  return (
    <div className="panel-fact">
      <dt className="mono-label">{label}</dt>
      <dd>
        {editor ?? (
          <>
            {children}
            <EditButton label={label} onClick={onEdit} />
          </>
        )}
      </dd>
    </div>
  )
}

function EditButton({ label, onClick }: { label: string; onClick?: () => void }) {
  if (!onClick) return null
  return (
    <button type="button" className="edit-button" aria-label={`Изменить: ${label}`} title="Изменить" onClick={onClick}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" />
      </svg>
    </button>
  )
}

/** Description with line breaks kept; past ~6 lines it folds behind «Показать полностью». */
function LongText({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [overflows, setOverflows] = useState(false)

  // The panel is a dialog that opens after the first render, so measure on resize rather than once.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const check = () => setOverflows(el.scrollHeight > el.clientHeight + 1)
    const observer = new ResizeObserver(check)
    observer.observe(el)
    check()
    return () => observer.disconnect()
  }, [text])

  return (
    <>
      <p ref={ref} className={`panel-text${expanded ? '' : ' is-clamped'}`}>
        {text}
      </p>
      {(overflows || expanded) && (
        <button type="button" className="link-button" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Свернуть' : 'Показать полностью'}
        </button>
      )}
    </>
  )
}

interface EditorProps {
  task: Task
  lookup: Lookup
  onOpenTask: (id: string) => void
  /** Saves what changed, reloads, closes the editor; throws on failure. */
  update: (changes: Partial<TaskFormValues>) => Promise<void>
  onCancel: () => void
}

type EditorFormProps = Pick<EditorProps, 'lookup' | 'onOpenTask' | 'onCancel'> & {
  save: () => Promise<void>
  children: ReactNode
}

/** Draft controls with Save and Cancel; Esc cancels without closing the panel. */
function EditorForm({ save, onCancel, lookup, onOpenTask, children }: EditorFormProps) {
  const action = useAction()

  function submit(e: FormEvent) {
    e.preventDefault()
    void action.run(save)
  }

  return (
    <form
      className="form inline-edit"
      noValidate
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return
        e.preventDefault()
        e.stopPropagation()
        onCancel()
      }}
    >
      {children}
      <ErrorNote error={action.error} lookup={lookup} onOpenTask={onOpenTask} />
      <div className="form-actions">
        <button type="submit" className="btn btn-primary btn-sm" disabled={action.busy}>
          {action.busy ? 'Сохраняем…' : 'Сохранить'}
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onCancel}>
          Отмена
        </button>
      </div>
    </form>
  )
}

function TitleEditor({ task, update, ...rest }: EditorProps) {
  const [title, setTitle] = useState(task.title)
  async function save() {
    if (!title.trim()) throw new FormError('Введите название задачи.')
    await update({ title: title.trim() })
  }
  return (
    <EditorForm save={save} {...rest}>
      <input className="input" aria-label="Название" maxLength={200} autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
    </EditorForm>
  )
}

function DescriptionEditor({ task, update, ...rest }: EditorProps) {
  const [description, setDescription] = useState(task.description)
  return (
    <EditorForm save={() => update({ description })} {...rest}>
      <textarea
        className="input textarea"
        aria-label="Описание"
        rows={6}
        maxLength={10000}
        autoFocus
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
    </EditorForm>
  )
}

function ResponsibleEditor({ task, update, viewer, ...rest }: EditorProps & { viewer: UserDto }) {
  const [responsibleId, setResponsibleId] = useState(task.responsibleId)
  const options = activeUsers(rest.lookup).filter((user) => canCreateTask(viewer, user.id, user.role))
  const current = rest.lookup.users.get(task.responsibleId)
  if (current && !options.includes(current)) options.unshift(current)
  return (
    <EditorForm save={() => update({ responsibleId })} {...rest}>
      <select className="input" aria-label="Ответственный" autoFocus value={responsibleId} onChange={(e) => setResponsibleId(e.target.value)}>
        {options.map((user) => (
          <option key={user.id} value={user.id}>
            {fullName(user)}
          </option>
        ))}
      </select>
    </EditorForm>
  )
}

function CoexecutorsEditor({ task, update, ...rest }: EditorProps) {
  const [ids, setIds] = useState(task.coexecutorIds)
  // Someone disabled stays listed while still on the task, so saving does not drop them silently.
  const options = [...rest.lookup.users.values()]
    .filter((user) => user.id !== task.responsibleId && (!user.disabled || task.coexecutorIds.includes(user.id)))
    .sort(byName)
  return (
    <EditorForm save={() => update({ coexecutorIds: ids })} {...rest}>
      <fieldset className="field checks" aria-label="Соисполнители">
        {options.map((user) => (
          <label key={user.id} className="check-row">
            <input
              type="checkbox"
              checked={ids.includes(user.id)}
              onChange={(e) => setIds(e.target.checked ? [...ids, user.id] : ids.filter((id) => id !== user.id))}
            />
            {fullName(user)}
          </label>
        ))}
      </fieldset>
    </EditorForm>
  )
}

function DueEditor({ task, update, ...rest }: EditorProps) {
  const [dueDate, setDueDate] = useState(task.dueDate)
  const [dueTime, setDueTime] = useState(task.dueTime ?? '')
  async function save() {
    if (!dueDate) throw new FormError('Укажите срок — дата обязательна.')
    await update({ dueDate, dueTime })
  }
  return (
    <EditorForm save={save} {...rest}>
      <div className="field-row">
        <input className="input" type="date" aria-label="Дата" required autoFocus value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        <input className="input" type="time" aria-label="Время (МСК), необязательно" value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
      </div>
    </EditorForm>
  )
}

function PriorityEditor({ task, update, allowHot, ...rest }: EditorProps & { allowHot: boolean }) {
  const [priority, setPriority] = useState(task.priority)
  const options = PRIORITIES.filter((p) => p !== 'hot' || allowHot || task.priority === 'hot')
  return (
    <EditorForm save={() => update({ priority })} {...rest}>
      <select className="input" aria-label="Приоритет" autoFocus value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
        {options.map((p) => (
          <option key={p} value={p} disabled={p === 'hot' && !allowHot}>
            {PRIORITY_LABELS[p]}
          </option>
        ))}
      </select>
    </EditorForm>
  )
}

function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id))
}
