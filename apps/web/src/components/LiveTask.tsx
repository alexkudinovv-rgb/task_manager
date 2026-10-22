import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  DueChangeRequestInput,
  canCreateSubtask,
  type Task,
  type TaskDetailsDto,
  type TaskEvent,
  type TaskEventDto,
  type TransitionInput,
  type UserDto,
} from '@car-city/shared/model'
import { serverApi } from '../api'
import { Attachments } from '../attachments/Attachments'
import { ChatPanel, useLive } from '../chat'
import { FormError } from '../api/errors'
import { formatDay } from '../dates'
import { findUser, fullName, type Lookup, type TaskView } from '../workspace'
import { TaskSummary } from './InlineFields'
import { TaskForm, newTaskValues, toCreateInput, type TaskFormValues } from './TaskForm'
import { SubtaskList } from './TaskParts'
import { ErrorNote, Field, formatMoment, useAction } from './ui'

interface Props {
  view: TaskView
  viewer: UserDto
  lookup: Lookup
  /** Visible subtasks from the workspace. */
  subtasks: Task[]
  /** Reloads the workspace after a change. */
  onChanged: () => Promise<void>
  onOpenTask: (id: string) => void
}

interface SectionProps {
  details: TaskDetailsDto
  viewer: UserDto
  lookup: Lookup
  refresh: () => Promise<void>
  onOpenTask: (id: string) => void
}

/** Real-mode body of the task panel: details from GET /api/tasks/:id and the actions it allows. */
export function LiveTask({ view, viewer, lookup, subtasks, onChanged, onOpenTask }: Props) {
  const taskId = view.task.id
  const [details, setDetails] = useState<TaskDetailsDto | null>(null)
  const [loadError, setLoadError] = useState<unknown>(null)

  const load = useCallback(async () => {
    try {
      setDetails(await serverApi.taskDetails(taskId))
      setLoadError(null)
    } catch (error) {
      setLoadError(error)
    }
  }, [taskId])

  useEffect(() => {
    void load()
  }, [load])

  const refresh = useCallback(async () => {
    await Promise.all([load(), onChanged()])
  }, [load, onChanged])

  // Someone else changed this task (or a subtask of it): refetch the details and the file list.
  // The workspace itself is reloaded by MainScreen on the same event.
  const [revision, setRevision] = useState(0)
  useLive(
    (event) => {
      if (event.type !== 'task.changed' || event.taskId !== taskId) return
      void load()
      setRevision((n) => n + 1)
    },
    { onReconnect: () => void load() },
  )

  // Title, facts and subtasks come from the workspace, so they show before the details arrive.
  const summary = (
    <>
      <TaskSummary view={view} viewer={viewer} lookup={lookup} allowed={details?.allowedActions} refresh={refresh} onOpenTask={onOpenTask} />
      <Subtasks subtasks={subtasks} details={details} viewer={viewer} lookup={lookup} refresh={refresh} onOpenTask={onOpenTask} />
    </>
  )

  if (!details) {
    return (
      <>
        {summary}
        <section className="panel-section">{loadError ? <ErrorNote error={loadError} /> : <p className="muted">Загрузка…</p>}</section>
      </>
    )
  }

  const props: SectionProps = { details, viewer, lookup, refresh, onOpenTask }
  // Writing in the chat does not make the task editable.
  const canAct = Object.entries(details.allowedActions).some(([key, on]) => on && key !== 'comment')
  const readOnly = !canAct && details.checklist.length === 0 && !details.pendingDueRequest
  return (
    <>
      {summary}
      <StatusActions {...props} />
      <DueRequest {...props} />
      <Checklist {...props} />
      <Attachments
        taskId={details.task.id}
        canUpload={details.task.status !== 'done'}
        canDelete={(file) =>
          details.task.status !== 'done' &&
          (file.uploadedBy === viewer.id || details.task.authorId === viewer.id || viewer.role === 'owner')
        }
        onChanged={() => void refresh()}
        userName={(id) => fullName(findUser(lookup, id))}
        revision={revision}
      />
      <section className="panel-section">
        <span className="mono-label">Обсуждение</span>
        <ChatPanel chatKey={details.task.id} readOnly={!details.allowedActions.comment} users={[...lookup.users.values()]} me={viewer} />
      </section>
      {readOnly && (
        <section className="panel-section">
          <p className="muted">Только просмотр.</p>
        </section>
      )}
      <History events={details.events} lookup={lookup} />
    </>
  )
}

function StatusActions({ details, lookup, refresh, onOpenTask }: SectionProps) {
  const { task, allowedActions: allowed } = details
  const action = useAction()
  const [closing, setClosing] = useState<'cancel' | 'reopen' | null>(null)
  const [comment, setComment] = useState('')

  if (!allowed.start && !allowed.complete && !allowed.cancel && !allowed.reopen) return null

  const transition = (input: TransitionInput) =>
    action.run(async () => {
      await serverApi.transition(task.id, input)
      setClosing(null)
      setComment('')
      await refresh()
    })

  function submitComment(e: FormEvent) {
    e.preventDefault()
    const text = comment.trim()
    if (!text) return
    void transition(closing === 'cancel' ? { to: 'done', cancelled: true, comment: text } : { to: 'in_progress', comment: text })
  }

  function ask(kind: 'cancel' | 'reopen') {
    action.clear()
    setComment('')
    setClosing(kind)
  }

  const needsDocument = allowed.complete && task.requiresDocument && task.attachmentCount === 0

  return (
    <section className="panel-section">
      <h3 className="mono-label">Статус</h3>
      <div className="panel-actions">
        {allowed.start && (
          <button type="button" className="chip chip-accent" disabled={action.busy} onClick={() => void transition({ to: 'in_progress' })}>
            Взять в работу
          </button>
        )}
        {allowed.complete && (
          <button type="button" className="chip chip-accent" disabled={action.busy} onClick={() => void transition({ to: 'done' })}>
            Завершить
          </button>
        )}
        {allowed.cancel && (
          <button type="button" className="chip" disabled={action.busy} onClick={() => ask('cancel')}>
            Отменить
          </button>
        )}
        {allowed.reopen && (
          <button type="button" className="chip chip-accent" disabled={action.busy} onClick={() => ask('reopen')}>
            Вернуть в работу
          </button>
        )}
      </div>
      {needsDocument && <p className="muted">Завершить можно только с приложенным документом — добавьте его в блоке «Файлы».</p>}
      {closing && (
        <form className="form" onSubmit={submitComment}>
          <Field label={closing === 'cancel' ? 'Почему задача больше не нужна' : 'Что нужно доделать'} hint="Комментарий обязателен.">
            <textarea className="input textarea" rows={3} maxLength={10000} autoFocus value={comment} onChange={(e) => setComment(e.target.value)} />
          </Field>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={action.busy || !comment.trim()}>
              {closing === 'cancel' ? 'Отменить задачу' : 'Вернуть в работу'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setClosing(null)}>
              Назад
            </button>
          </div>
        </form>
      )}
      <ErrorNote error={action.error} lookup={lookup} onOpenTask={onOpenTask} />
    </section>
  )
}

function DueRequest({ details, lookup, refresh }: SectionProps) {
  const { task, allowedActions: allowed, pendingDueRequest: pending } = details
  const action = useAction()
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState(task.dueDate)
  const [time, setTime] = useState(task.dueTime ?? '')
  const [reason, setReason] = useState('')
  const [comment, setComment] = useState('')

  if (!pending && !allowed.requestDueChange) return null

  function submitRequest(e: FormEvent) {
    e.preventDefault()
    void action.run(async () => {
      if (!reason.trim()) throw new FormError('Напишите причину переноса.')
      const parsed = DueChangeRequestInput.safeParse({ dueDate: date, ...(time ? { dueTime: time } : {}), reason })
      if (!parsed.success) throw new FormError('Проверьте новую дату и время.')
      await serverApi.requestDueChange(task.id, parsed.data)
      setOpen(false)
      setReason('')
      await refresh()
    })
  }

  const decide = (requestId: string, approve: boolean) =>
    action.run(async () => {
      const text = comment.trim()
      await serverApi.decideDueRequest(requestId, { approve, ...(text ? { comment: text } : {}) })
      setComment('')
      await refresh()
    })

  return (
    <section className="panel-section">
      <h3 className="mono-label">Перенос срока</h3>
      {pending ? (
        <div className="due-request">
          <p>
            {fullName(findUser(lookup, pending.requestedBy))} просит перенести срок на{' '}
            <b className="mono-inline">
              {formatDay(pending.newDueDate)}
              {pending.newDueTime ? `, ${pending.newDueTime}` : ''}
            </b>
          </p>
          <p className="muted">Причина: {pending.reason}</p>
          {allowed.decideDueRequest ? (
            <div className="form">
              <Field label="Комментарий" hint="Необязательно">
                <input className="input" maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} />
              </Field>
              <div className="form-actions">
                <button type="button" className="btn btn-primary" disabled={action.busy} onClick={() => void decide(pending.id, true)}>
                  Согласовать
                </button>
                <button type="button" className="btn btn-secondary" disabled={action.busy} onClick={() => void decide(pending.id, false)}>
                  Отказать
                </button>
              </div>
            </div>
          ) : (
            <p className="muted">Ждёт решения постановщика.</p>
          )}
        </div>
      ) : open ? (
        <form className="form" onSubmit={submitRequest} noValidate>
          <div className="field-row">
            <Field label="Новый срок">
              <input className="input" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Время (МСК)" hint="Необязательно">
              <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </Field>
          </div>
          <Field label="Причина">
            <textarea className="input textarea" rows={2} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={action.busy}>
              Отправить постановщику
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>
              Отмена
            </button>
          </div>
        </form>
      ) : (
        <div className="panel-actions">
          <button type="button" className="chip" onClick={() => setOpen(true)}>
            Попросить перенос срока
          </button>
        </div>
      )}
      <ErrorNote error={action.error} />
    </section>
  )
}

function Checklist({ details, refresh }: SectionProps) {
  const { task, checklist, allowedActions: allowed } = details
  const action = useAction()
  const [text, setText] = useState('')

  // The contract has no checklist flag: whoever drives an open task (manageCoexecutors) keeps its checklist.
  const editable = allowed.manageCoexecutors
  if (checklist.length === 0 && !editable) return null

  const items = [...checklist].sort((a, b) => a.sort - b.sort)
  const done = items.filter((item) => item.done).length

  function add(e: FormEvent) {
    e.preventDefault()
    const value = text.trim()
    if (!value) return
    void action.run(async () => {
      await serverApi.addChecklistItem(task.id, { text: value })
      setText('')
      await refresh()
    })
  }

  return (
    <section className="panel-section">
      <h3 className="mono-label">
        Чек-лист{' '}
        <span className="mono muted">
          {done}/{items.length}
        </span>
      </h3>
      {items.length > 0 && (
        <ul className="checklist">
          {items.map((item) => (
            <li key={item.id}>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={item.done}
                  disabled={!editable || action.busy}
                  onChange={() =>
                    void action.run(async () => {
                      await serverApi.updateChecklistItem(item.id, { done: !item.done })
                      await refresh()
                    })
                  }
                />
                <span className={item.done ? 'is-done' : undefined}>{item.text}</span>
              </label>
              {editable && (
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Удалить пункт «${item.text}»`}
                  disabled={action.busy}
                  onClick={() =>
                    void action.run(async () => {
                      await serverApi.deleteChecklistItem(item.id)
                      await refresh()
                    })
                  }
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <form className="inline-form" onSubmit={add}>
          <input className="input" placeholder="Новый пункт" maxLength={500} value={text} onChange={(e) => setText(e.target.value)} />
          <button type="submit" className="btn btn-secondary" disabled={action.busy || !text.trim()}>
            Добавить
          </button>
        </form>
      )}
      <ErrorNote error={action.error} />
    </section>
  )
}

type SubtasksProps = Omit<SectionProps, 'details'> & { details: TaskDetailsDto | null; subtasks: Task[] }

/** The list, then «Добавить подзадачу» for whoever drives the task. */
function Subtasks({ subtasks, details, viewer, lookup, refresh, onOpenTask }: SubtasksProps) {
  const [open, setOpen] = useState(false)
  const canAdd = details?.allowedActions.addSubtask ?? false
  if (subtasks.length === 0 && !canAdd) return null

  const done = subtasks.filter((s) => s.status === 'done').length

  async function create(values: TaskFormValues) {
    if (!details) return
    await serverApi.createTask(toCreateInput(values, details.task.id))
    setOpen(false)
    await refresh()
  }

  return (
    <section className="panel-section">
      <h3 className="mono-label">
        Подзадачи{' '}
        {subtasks.length > 0 && (
          <span className="mono muted">
            {done}/{subtasks.length}
          </span>
        )}
      </h3>
      {subtasks.length > 0 && <SubtaskList subtasks={subtasks} lookup={lookup} onOpenTask={onOpenTask} />}
      {details && canAdd && open && (
        <TaskForm
          initial={newTaskValues(viewer.id)}
          lookup={lookup}
          canAssign={(user) => canCreateSubtask(viewer, details.task, user.role)}
          allowHot={viewer.role === 'owner'}
          submitLabel="Создать подзадачу"
          onSubmit={create}
          onCancel={() => setOpen(false)}
          onOpenTask={onOpenTask}
        />
      )}
      {canAdd && !open && (
        <div className="panel-actions">
          <button type="button" className="chip" onClick={() => setOpen(true)}>
            + Добавить подзадачу
          </button>
        </div>
      )}
    </section>
  )
}

// Record over TaskEvent: a new event type in the shared model fails typecheck until it gets a label here.
const EVENT_LABELS: Record<TaskEvent, string> = {
  task_created: 'поставил(а) задачу',
  task_started: 'взял(а) в работу',
  task_completed: 'завершил(а)',
  task_cancelled: 'отменил(а)',
  task_reopened: 'вернул(а) в работу',
  due_changed: 'изменил(а) срок',
  due_change_requested: 'попросил(а) перенос срока',
  due_change_decided: 'ответил(а) на запрос переноса',
  due_reminder: 'напоминание о сроке',
  hot_set: 'поставил(а) «Горит»',
  task_overdue: 'срок прошёл',
  task_updated: 'изменил(а) задачу',
  coexecutors_changed: 'изменил(а) соисполнителей',
  checklist_item_added: 'добавил(а) пункт чек-листа',
  checklist_item_updated: 'отметил(а) пункт чек-листа',
  checklist_item_removed: 'удалил(а) пункт чек-листа',
}

function History({ events, lookup }: { events: TaskEventDto[]; lookup: Lookup }) {
  if (events.length === 0) return null
  const latest = [...events].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 10)
  return (
    <section className="panel-section">
      <h3 className="mono-label">История</h3>
      <ul className="history">
        {latest.map((event) => (
          <li key={event.id}>
            <span className="mono muted">{formatMoment(event.at)}</span>
            <span>
              {event.actorId ? `${fullName(findUser(lookup, event.actorId))} ` : 'Система: '}
              {EVENT_LABELS[event.type as TaskEvent] ?? event.type}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
