import { PRIORITY_LABELS, TASK_STATUS_LABELS, type Progress, type Task, type TaskStatus, type UserDto } from '@car-city/shared/model'
import { findUser, fullName, initials, type Lookup, type TaskView } from '../workspace'

/** Statuses reuse the vehicle-class pastels from the guide. */
export const STATUS_TONE: Record<TaskStatus, string> = {
  new: 'slate',
  in_progress: 'blue',
  done: 'green',
}

export function StatusTag({ view }: { view: TaskView }) {
  const { status, cancelled } = view.task
  if (status === 'done' && cancelled) return <span className="tag tone-sand">Отменена</span>
  return <span className={`tag tone-${STATUS_TONE[status]}`}>{TASK_STATUS_LABELS[status]}</span>
}

/** Priority (every level, so «Средний» is not mistaken for «no priority»), overdue, cancelled and document marks. */
export function TaskFlags({ view, withCancelled = true }: { view: TaskView; withCancelled?: boolean }) {
  const { task } = view
  const done = task.status === 'done'
  return (
    <>
      {view.hot ? <span className="tag tag-hot">{PRIORITY_LABELS.hot}</span> : <span className="tag">{PRIORITY_LABELS[task.priority]}</span>}
      {view.overdue && <span className="tag tag-overdue">Просрочено</span>}
      {withCancelled && done && task.cancelled && <span className="tag tag-cancelled">Отменена</span>}
      {task.requiresDocument && !done && <span className="tag tag-doc">Нужен документ</span>}
    </>
  )
}

export function Avatar({ user, small = false }: { user: UserDto; small?: boolean }) {
  return (
    <span className={`avatar${small ? ' avatar-sm' : ''}`} title={fullName(user)}>
      {initials(user)}
    </span>
  )
}

/** Small coexecutor avatars, then the responsible. */
export function People({ view }: { view: TaskView }) {
  return (
    <span className="people">
      {view.coexecutors.map((user) => (
        <Avatar key={user.id} user={user} small />
      ))}
      <Avatar user={view.responsible} />
    </span>
  )
}

export function ProgressBar({ progress, finished }: { progress: Progress; finished: boolean }) {
  return (
    <span className="progress" title="Подзадачи и чек-лист">
      <span className="progress-track">
        <span className={`progress-fill${finished ? ' is-finished' : ''}`} style={{ width: `${Math.round(100 * progress.ratio)}%` }} />
      </span>
      <span className="mono">
        {progress.done}/{progress.total}
      </span>
    </span>
  )
}

/** Title as a button whose hit area stretches over the whole card or row. */
export function OpenTitle({ view, onOpen, as: Tag = 'h3' }: { view: TaskView; onOpen: (id: string) => void; as?: 'h3' | 'span' }) {
  const finished = view.task.status === 'done'
  return (
    <Tag className={`task-title${finished ? ' is-finished' : ''}`}>
      <button type="button" className="task-open" onClick={() => onOpen(view.task.id)}>
        {view.task.title}
      </button>
    </Tag>
  )
}

/** Subtasks inside the parent's panel: title opens the subtask, then responsible and status. */
export function SubtaskList({ subtasks, lookup, onOpenTask }: { subtasks: Task[]; lookup: Lookup; onOpenTask: (id: string) => void }) {
  return (
    <ul className="panel-subtasks">
      {subtasks.map((s) => (
        <li key={s.id}>
          <button type="button" className={`task-open task-title${s.status === 'done' ? ' is-finished' : ''}`} onClick={() => onOpenTask(s.id)}>
            {s.title}
          </button>
          <span className="muted">
            {fullName(findUser(lookup, s.responsibleId))} · {TASK_STATUS_LABELS[s.status]}
          </span>
        </li>
      ))}
    </ul>
  )
}

export function CalendarIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  )
}

export function ChatIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
    </svg>
  )
}
