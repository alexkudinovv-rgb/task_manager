import { useEffect, useRef, type ReactNode } from 'react'
import {
  TASK_STATUS_LABELS,
  allowedActions,
  checkHotLimit,
  checkTransition,
  type AllowedActions,
} from '@car-city/shared/model'
import type { User } from '../api'
import { formatDay } from '../dates'
import { canViewerSee, findUser, fullName, visibilityContext, type Lookup, type TaskView } from '../workspace'
import { StatusTag, TaskFlags } from './TaskParts'

interface Props {
  view: TaskView
  viewer: User
  lookup: Lookup
  onClose: () => void
}

// decideDueRequest is left out: the demo has no pending due change requests.
const ACTION_LABELS: [keyof AllowedActions, string][] = [
  ['start', 'Взять в работу'],
  ['complete', 'Завершить'],
  ['cancel', 'Отменить'],
  ['reopen', 'Вернуть в работу'],
  ['edit', 'Изменить'],
  ['changeDue', 'Изменить срок'],
  ['requestDueChange', 'Попросить перенос срока'],
  ['setPriority', 'Сменить приоритет'],
  ['setHot', 'Поставить «Горит»'],
  ['manageCoexecutors', 'Соисполнители'],
  ['addSubtask', 'Добавить подзадачу'],
  ['comment', 'Написать в чат'],
]

export function TaskPanel({ view, viewer, lookup, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    dialog.current?.showModal()
  }, [])

  const { task } = view
  const subtasks = (lookup.subtasksByParent.get(task.id) ?? []).filter((s) => canViewerSee(viewer, s, lookup))
  const responsiblePosition = view.responsible.positionId ? lookup.positions.get(view.responsible.positionId)?.name : null

  return (
    <dialog
      ref={dialog}
      className="panel"
      aria-labelledby="panel-title"
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && dialog.current?.close()}
    >
      <div className="panel-body">
        <div className="panel-head">
          <div className="task-tags">
            <StatusTag view={view} />
            <TaskFlags view={view} withCancelled={false} />
          </div>
          <button type="button" className="panel-close" aria-label="Закрыть" onClick={() => dialog.current?.close()}>
            ✕
          </button>
        </div>

        <h2 id="panel-title" className="panel-title">
          {task.title}
        </h2>
        {task.description && <p className="panel-text">{task.description}</p>}

        <dl className="panel-facts">
          <Fact label="Ответственный">
            {fullName(view.responsible)}
            {responsiblePosition && <span className="muted"> · {responsiblePosition}</span>}
          </Fact>
          <Fact label="Постановщик">{fullName(view.author)}</Fact>
          {view.coexecutors.length > 0 && <Fact label="Соисполнители">{view.coexecutors.map(fullName).join(', ')}</Fact>}
          <Fact label="Подразделение">{view.unit?.name ?? '—'}</Fact>
          <Fact label="Срок">
            <span className={`mono due${view.overdue ? ' is-overdue' : ''}`}>{view.dueLabel}</span>
          </Fact>
          <Fact label="Создана">{formatDay(task.createdAt)}</Fact>
          {task.completedAt && <Fact label={task.cancelled ? 'Отменена' : 'Завершена'}>{formatDay(task.completedAt)}</Fact>}
          {task.requiresDocument && (
            <Fact label="Документ">{task.attachmentCount > 0 ? 'Приложен' : 'Нужен, пока не приложен'}</Fact>
          )}
          <Fact label="Прогресс">
            подзадачи {task.subtasks.done}/{task.subtasks.total} · чек-лист {task.checklist.done}/{task.checklist.total}
          </Fact>
        </dl>

        {subtasks.length > 0 && (
          <section className="panel-section">
            <h3 className="mono-label">Подзадачи</h3>
            <ul className="panel-subtasks">
              {subtasks.map((s) => (
                <li key={s.id}>
                  <span className={`task-title${s.status === 'done' ? ' is-finished' : ''}`}>{s.title}</span>
                  <span className="muted">
                    {fullName(findUser(lookup, s.responsibleId))} · {TASK_STATUS_LABELS[s.status]}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <Actions view={view} viewer={viewer} lookup={lookup} />
      </div>
    </dialog>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="panel-fact">
      <dt className="mono-label">{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

/** What the policy lets the current viewer do; shown, not wired. */
function Actions({ view, viewer, lookup }: { view: TaskView; viewer: User; lookup: Lookup }) {
  const { task } = view
  const allowed = allowedActions(viewer, task, visibilityContext(task, lookup))
  const actions = ACTION_LABELS.filter(([key]) => allowed[key]).map(([key, label]) =>
    key === 'setHot' && view.hot ? ([key, 'Снять «Горит»'] as const) : ([key, label] as const),
  )

  const notes: string[] = []
  const finish = checkTransition(viewer, task, 'done')
  if (allowed.complete && !finish.ok && finish.code === 'document_required') {
    notes.push('Завершить можно только с приложенным документом.')
  }
  if (allowed.setHot && !view.hot && task.status !== 'done') {
    const openHot = [...lookup.tasks.values()]
      .filter((t) => t.responsibleId === task.responsibleId && t.priority === 'hot' && t.status !== 'done')
      .map((t) => t.id)
    if (!checkHotLimit(openHot, task.id).ok) notes.push('У ответственного уже есть горящая задача — вторую поставить нельзя.')
  }

  return (
    <section className="panel-section">
      <h3 className="mono-label">Доступные действия</h3>
      {actions.length > 0 ? (
        <div className="panel-actions">
          {actions.map(([key, label]) => (
            <button key={key} type="button" className="chip" disabled>
              {label}
            </button>
          ))}
        </div>
      ) : (
        <p className="muted">Только просмотр.</p>
      )}
      {notes.map((note) => (
        <p key={note} className="muted">
          {note}
        </p>
      ))}
      <p className="panel-note">В тестовой версии действия не сохраняются.</p>
    </section>
  )
}
