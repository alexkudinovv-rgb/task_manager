import { TASK_STATUSES, TASK_STATUS_LABELS } from '@car-city/shared/model'
import { fullName, type TaskView } from '../workspace'
import { CalendarIcon, ChatIcon, OpenTitle, People, ProgressBar, STATUS_TONE, TaskFlags } from './TaskParts'

interface Props {
  views: TaskView[]
  onOpen: (id: string) => void
}

export function BoardView({ views, onOpen }: Props) {
  return (
    <div className="board-scroll">
      <div className="board">
        {TASK_STATUSES.map((status) => {
          const column = views.filter((view) => view.task.status === status)
          return (
            <section key={status} className="board-column" aria-label={TASK_STATUS_LABELS[status]}>
              <header className="board-column-head">
                <span className={`dot tone-${STATUS_TONE[status]}`} />
                <h2 className="mono-label">{TASK_STATUS_LABELS[status]}</h2>
                <span className="mono muted">{column.length}</span>
              </header>
              {column.map((view) => (
                <TaskCard key={view.task.id} view={view} onOpen={onOpen} />
              ))}
              {column.length === 0 && <p className="board-empty">Пусто</p>}
            </section>
          )
        })}
      </div>
    </div>
  )
}

function TaskCard({ view, onOpen }: { view: TaskView; onOpen: (id: string) => void }) {
  const { task } = view
  const finished = task.status === 'done'
  return (
    <article className="card task-card">
      <div className="task-tags">
        <TaskFlags view={view} />
      </div>
      <OpenTitle view={view} onOpen={onOpen} />
      {view.author.role !== 'owner' && <span className="task-author">Постановщик — {fullName(view.author)}</span>}
      {view.progress.total > 0 && <ProgressBar progress={view.progress} finished={finished} />}
      <div className="task-footer">
        <span className={`mono due${view.overdue ? ' is-overdue' : ''}`}>
          <CalendarIcon />
          {view.dueLabel}
        </span>
        <span className="comments" title="Комментарии">
          <ChatIcon />
          {task.commentCount}
        </span>
        <People view={view} />
      </div>
    </article>
  )
}
