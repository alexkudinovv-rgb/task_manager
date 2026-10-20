import type { Status, Task } from '@car-city/shared'
import { Avatar, CalendarIcon, ChatIcon, Flag, SubtaskBar, resolveTask, type Lookup } from './TaskParts'

interface Props {
  statuses: Status[]
  tasks: Task[]
  lookup: Lookup
}

export function BoardView({ statuses, tasks, lookup }: Props) {
  return (
    <div className="board-scroll">
      <div className="board" style={{ gridTemplateColumns: `repeat(${statuses.length}, minmax(250px, 1fr))` }}>
        {statuses.map((status) => {
          const column = tasks.filter((task) => task.statusId === status.id)
          return (
            <section key={status.id} className="board-column" aria-label={status.title}>
              <header className="board-column-head">
                <span className={`dot tone-${status.tone}`} />
                <h2 className="mono-label">{status.title}</h2>
                <span className="mono muted">{column.length}</span>
              </header>
              {column.map((task) => (
                <TaskCard key={task.id} task={task} lookup={lookup} />
              ))}
              {column.length === 0 && <p className="board-empty">Пусто</p>}
            </section>
          )
        })}
      </div>
    </div>
  )
}

function TaskCard({ task, lookup }: { task: Task; lookup: Lookup }) {
  const view = resolveTask(task, lookup)
  const finished = view.status.isFinal
  return (
    <article className="card task-card">
      <div className="task-tags">
        <span className="tag">{view.department.name}</span>
        {view.hot && <Flag kind="hot" />}
        {view.overdue && <Flag kind="overdue" />}
      </div>
      <h3 className={`task-title${finished ? ' is-finished' : ''}`}>{task.title}</h3>
      {task.subtasks.total > 0 && <SubtaskBar {...task.subtasks} finished={finished} />}
      <div className="task-footer">
        <span className={`mono due${view.overdue ? ' is-overdue' : ''}`}>
          <CalendarIcon />
          {view.dueLabel}
        </span>
        <span className="comments">
          <ChatIcon />
          {task.comments}
        </span>
        <Avatar name={view.assignee.name} />
      </div>
    </article>
  )
}
