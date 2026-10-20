import { plural } from '../dates'
import type { Department, Task } from '../domain'
import { Avatar, SubtaskBar, resolveTask, type Lookup } from './TaskParts'

interface Props {
  departments: Department[]
  tasks: Task[]
  lookup: Lookup
}

export function ListView({ departments, tasks, lookup }: Props) {
  const groups = departments
    .map((department) => ({ department, tasks: tasks.filter((task) => task.departmentId === department.id) }))
    .filter((group) => group.tasks.length > 0)

  if (groups.length === 0) return <p className="card list-empty">Под фильтр не попала ни одна задача.</p>

  return (
    <div className="list">
      <div className="list-columns mono-label" aria-hidden="true">
        <span />
        <span>Задача</span>
        <span>Статус</span>
        <span>Ответственный</span>
        <span>Срок</span>
        <span>Подзадачи</span>
      </div>
      {groups.map(({ department, tasks: groupTasks }) => (
        <DepartmentGroup key={department.id} department={department} tasks={groupTasks} lookup={lookup} />
      ))}
    </div>
  )
}

function DepartmentGroup({ department, tasks, lookup }: { department: Department; tasks: Task[]; lookup: Lookup }) {
  const views = tasks.map((task) => ({ task, view: resolveTask(task, lookup) }))
  const hot = views.filter(({ view }) => view.hot).length
  const overdue = views.filter(({ view }) => view.overdue).length
  const lead = lookup.users.get(department.leadId)

  return (
    <section className="card list-group" aria-label={department.name}>
      <header className="list-group-head">
        <h2>{department.name}</h2>
        {lead && <span className="muted">руководитель — {lead.name}</span>}
        <span className="mono muted list-group-count">
          {tasks.length} {plural(tasks.length, ['задача', 'задачи', 'задач'])}
        </span>
        {hot > 0 && <span className="tag tag-hot">Горит · {hot}</span>}
        {overdue > 0 && <span className="tag tag-overdue">Просрочено · {overdue}</span>}
      </header>
      {views.map(({ task, view }) => (
        <div key={task.id} className="list-row">
          <span className={`check${view.status.isFinal ? ' is-checked' : ''}`} aria-hidden="true" />
          <div className="list-row-title">
            <span className={`task-title${view.status.isFinal ? ' is-finished' : ''}`}>{task.title}</span>
            <span className="muted">
              {task.comments} {plural(task.comments, ['комментарий', 'комментария', 'комментариев'])}
            </span>
          </div>
          <span className={`tag tone-${view.status.tone}`}>{view.status.title}</span>
          <span className="list-row-owner">
            <Avatar name={view.assignee.name} />
            {view.assignee.name}
          </span>
          <span className={`mono due${view.overdue ? ' is-overdue' : ''}`}>
            {(view.hot || view.overdue) && <span className={`dot ${view.overdue ? 'dot-overdue' : 'dot-hot'}`} />}
            {view.dueLabel}
          </span>
          {task.subtasks.total > 0 ? (
            <SubtaskBar {...task.subtasks} finished />
          ) : (
            <span className="mono muted">—</span>
          )}
        </div>
      ))}
    </section>
  )
}
