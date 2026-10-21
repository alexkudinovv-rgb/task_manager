import type { DirectoryItem } from '@car-city/shared/model'
import { plural } from '../dates'
import { fullName, type TaskView } from '../workspace'
import { Avatar, OpenTitle, ProgressBar, StatusTag, TaskFlags } from './TaskParts'

interface Props {
  units: DirectoryItem[]
  views: TaskView[]
  onOpen: (id: string) => void
}

const NO_UNIT: DirectoryItem = { id: '', name: 'Без подразделения' }

/** Grouped by the unit of the responsible, in the order of the units list. */
export function ListView({ units, views, onOpen }: Props) {
  const groups = [...units, NO_UNIT]
    .map((unit) => ({ unit, views: views.filter((view) => (view.unit?.id ?? '') === unit.id) }))
    .filter((group) => group.views.length > 0)

  if (groups.length === 0) return <p className="card list-empty">Под фильтр не попала ни одна задача.</p>

  return (
    <div className="list">
      <div className="list-columns mono-label" aria-hidden="true">
        <span />
        <span>Задача</span>
        <span>Статус</span>
        <span>Ответственный</span>
        <span>Срок</span>
        <span>Прогресс</span>
      </div>
      {groups.map((group) => (
        <UnitGroup key={group.unit.id} unit={group.unit} views={group.views} onOpen={onOpen} />
      ))}
    </div>
  )
}

function UnitGroup({ unit, views, onOpen }: { unit: DirectoryItem; views: TaskView[]; onOpen: (id: string) => void }) {
  const hot = views.filter((view) => view.hot).length
  const overdue = views.filter((view) => view.overdue).length

  return (
    <section className="card list-group" aria-label={unit.name}>
      <header className="list-group-head">
        <h2>{unit.name}</h2>
        <span className="mono muted list-group-count">
          {views.length} {plural(views.length, ['задача', 'задачи', 'задач'])}
        </span>
        {hot > 0 && <span className="tag tag-hot">Горит · {hot}</span>}
        {overdue > 0 && <span className="tag tag-overdue">Просрочено · {overdue}</span>}
      </header>
      {views.map((view) => (
        <ListRow key={view.task.id} view={view} onOpen={onOpen} />
      ))}
    </section>
  )
}

function ListRow({ view, onOpen }: { view: TaskView; onOpen: (id: string) => void }) {
  const { task } = view
  const finished = task.status === 'done'
  return (
    <div className="list-row">
      <span className={`check${finished ? ' is-checked' : ''}`} aria-hidden="true" />
      <div className="list-row-title">
        <OpenTitle view={view} onOpen={onOpen} as="span" />
        <span className="list-row-meta">
          <TaskFlags view={view} withCancelled={false} />
          <span className="muted">
            {task.commentCount} {plural(task.commentCount, ['комментарий', 'комментария', 'комментариев'])}
          </span>
        </span>
      </div>
      <StatusTag view={view} />
      <span className="list-row-owner">
        <Avatar user={view.responsible} />
        {fullName(view.responsible)}
      </span>
      <span className={`mono due${view.overdue ? ' is-overdue' : ''}`}>{view.dueLabel}</span>
      {view.progress.total > 0 ? (
        <ProgressBar progress={view.progress} finished />
      ) : (
        <span className="mono muted">—</span>
      )}
    </div>
  )
}
