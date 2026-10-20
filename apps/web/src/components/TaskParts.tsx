import { formatDue } from '../dates'
import { initials, isOverdue, type Department, type Status, type Task, type User } from '../domain'

export interface Lookup {
  today: string
  statuses: Map<string, Status>
  departments: Map<string, Department>
  users: Map<string, User>
}

function required<T>(map: Map<string, T>, id: string, kind: string): T {
  const value = map.get(id)
  if (!value) throw new Error(`Unknown ${kind}: ${id}`)
  return value
}

/** Everything a card or a row needs about one task, resolved once. */
export function resolveTask(task: Task, lookup: Lookup) {
  const status = required(lookup.statuses, task.statusId, 'status')
  const overdue = isOverdue(task, status, lookup.today)
  return {
    status,
    department: required(lookup.departments, task.departmentId, 'department'),
    assignee: required(lookup.users, task.assigneeId, 'user'),
    overdue,
    hot: task.isHot && !status.isFinal,
    dueLabel: formatDue(task, lookup.today, overdue),
  }
}

export function Avatar({ name }: { name: string }) {
  return (
    <span className="avatar" title={name}>
      {initials(name)}
    </span>
  )
}

export function Flag({ kind }: { kind: 'hot' | 'overdue' }) {
  return <span className={`tag tag-${kind}`}>{kind === 'hot' ? 'Горит' : 'Просрочено'}</span>
}

export function SubtaskBar({ done, total, finished }: { done: number; total: number; finished: boolean }) {
  return (
    <span className="subtasks">
      <span className="subtasks-track">
        <span
          className={`subtasks-fill${finished ? ' is-finished' : ''}`}
          style={{ width: `${Math.round((100 * done) / total)}%` }}
        />
      </span>
      <span className="mono">
        {done}/{total}
      </span>
    </span>
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
