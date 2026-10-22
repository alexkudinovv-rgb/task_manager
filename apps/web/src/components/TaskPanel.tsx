import { useEffect, useRef } from 'react'
import { allowedActions, checkHotLimit, checkTransition, type AllowedActions, type UserDto } from '@car-city/shared/model'
import { DEMO } from '../api'
import { canViewerSee, visibilityContext, type Lookup, type TaskView } from '../workspace'
import { TaskSummary } from './InlineFields'
import { LiveTask } from './LiveTask'
import { StatusTag, SubtaskList, TaskFlags } from './TaskParts'

interface Props {
  view: TaskView
  viewer: UserDto
  lookup: Lookup
  onClose: () => void
  /** Switch the panel to another task: a subtask, the parent, a conflicting hot task. */
  onOpenTask: (id: string) => void
  /** Reload the workspace after a change (real mode). */
  onChanged: () => Promise<void>
}

export function TaskPanel({ view, viewer, lookup, onClose, onOpenTask, onChanged }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    dialog.current?.showModal()
  }, [])

  const { task } = view
  const subtasks = (lookup.subtasksByParent.get(task.id) ?? []).filter((s) => !DEMO || canViewerSee(viewer, s, lookup))
  const parent = task.parentId ? lookup.tasks.get(task.parentId) : undefined

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

        {parent && (
          <button type="button" className="link-button panel-parent" onClick={() => onOpenTask(parent.id)}>
            ← Подзадача в «{parent.title}»
          </button>
        )}

        {DEMO ? (
          <>
            <TaskSummary view={view} viewer={viewer} lookup={lookup} onOpenTask={onOpenTask} />
            {subtasks.length > 0 && (
              <section className="panel-section">
                <h3 className="mono-label">Подзадачи</h3>
                <SubtaskList subtasks={subtasks} lookup={lookup} onOpenTask={onOpenTask} />
              </section>
            )}
            <DemoActions view={view} viewer={viewer} lookup={lookup} />
          </>
        ) : (
          <LiveTask view={view} viewer={viewer} lookup={lookup} subtasks={subtasks} onChanged={onChanged} onOpenTask={onOpenTask} />
        )}
      </div>
    </dialog>
  )
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

/** Demo: what the policy lets the chosen viewer do; shown, not wired. */
function DemoActions({ view, viewer, lookup }: { view: TaskView; viewer: UserDto; lookup: Lookup }) {
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
