import { useState } from 'react'
import type { UserDto, WorkspaceDto } from '@car-city/shared/model'
import { DEMO } from '../api'
import { byUrgency, fullName, type Lookup, type TaskView } from '../workspace'
import { BoardView } from './BoardView'
import { ListView } from './ListView'

type View = 'board' | 'list'
type QuickFilter = 'all' | 'hot' | 'overdue'

const VIEWS: { id: View; label: string; title: [string, string] }[] = [
  { id: 'board', label: 'Канбан', title: ['Доска', 'задач'] },
  { id: 'list', label: 'Список', title: ['Все', 'задачи'] },
]

interface Props {
  workspace: WorkspaceDto
  lookup: Lookup
  /** Top-level tasks the viewer can see. */
  visible: TaskView[]
  viewer: UserDto
  /** Demo only: «Смотреть как». */
  onViewerChange: (id: string) => void
  unitId: string | null
  onUnitChange: (id: string | null) => void
  onOpen: (id: string) => void
  onCreate: () => void
}

export function TasksPage({ workspace, lookup, visible, viewer, onViewerChange, unitId, onUnitChange, onOpen, onCreate }: Props) {
  const [view, setView] = useState<View>('board')
  const [quick, setQuick] = useState<QuickFilter>('all')
  const [query, setQuery] = useState('')
  const [showDone, setShowDone] = useState(false)

  const needle = query.trim().toLowerCase()
  const scoped = visible
    .filter((v) => !unitId || v.unit?.id === unitId)
    .filter((v) => !needle || v.task.title.toLowerCase().includes(needle))
  const shown = scoped
    .filter((v) => {
      if (quick === 'hot') return v.hot
      if (quick === 'overdue') return v.overdue
      return view === 'board' || showDone || v.task.status !== 'done'
    })
    .sort(byUrgency)

  const current = VIEWS.find((v) => v.id === view)!
  const quickFilters: { id: QuickFilter; label: string; count: number }[] = [
    { id: 'all', label: 'Все', count: scoped.length },
    { id: 'hot', label: 'Горит', count: scoped.filter((v) => v.hot).length },
    { id: 'overdue', label: 'Просрочено', count: scoped.filter((v) => v.overdue).length },
  ]

  function create() {
    if (DEMO) window.alert('В тестовой версии задачи не создаются — это доступно в рабочей версии.')
    else onCreate()
  }

  return (
    <>
      <header className="page-head">
        <div className="page-head-title">
          <span className="mono-label with-checker">{DEMO ? 'Тестовая версия · подставные данные' : `Car City · ${fullName(viewer)}`}</span>
          <h1>
            {current.title[0]} <span className="marker">{current.title[1]}</span>
          </h1>
        </div>
        <div className="page-head-actions">
          {DEMO && <ViewerSwitch users={workspace.users} viewerId={viewer.id} onChange={onViewerChange} />}
          <label className="search">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-4-4" />
            </svg>
            <input type="search" placeholder="Найти задачу" aria-label="Найти задачу" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <button type="button" className="btn btn-primary" onClick={create}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Создать задачу
          </button>
        </div>
      </header>

      <div className="toolbar">
        <div className="segmented" role="group" aria-label="Вид">
          {VIEWS.map((v) => (
            <button key={v.id} type="button" className={v.id === view ? 'is-active' : undefined} aria-pressed={v.id === view} onClick={() => setView(v.id)}>
              {v.label}
            </button>
          ))}
        </div>
        {quickFilters.map((filter) => (
          <button
            key={filter.id}
            type="button"
            className={`chip${quick === filter.id ? ' is-active' : ''}`}
            aria-pressed={quick === filter.id}
            onClick={() => setQuick(filter.id)}
          >
            {filter.label} <span className="mono">{filter.count}</span>
          </button>
        ))}
        {view === 'list' && quick === 'all' && (
          <button type="button" className={`chip${showDone ? ' is-active' : ''}`} aria-pressed={showDone} onClick={() => setShowDone(!showDone)}>
            Показать завершённые
          </button>
        )}
        {unitId && (
          <button type="button" className="chip" onClick={() => onUnitChange(null)}>
            {lookup.units.get(unitId)?.name} ✕
          </button>
        )}
      </div>

      {view === 'board' ? <BoardView views={shown} onOpen={onOpen} /> : <ListView units={workspace.units} views={shown} onOpen={onOpen} />}
    </>
  )
}

/** Demo-only: look at the board through someone else's eyes; visibility follows canSee. */
function ViewerSwitch({ users, viewerId, onChange }: { users: UserDto[]; viewerId: string; onChange: (id: string) => void }) {
  return (
    <label className="viewer">
      <span className="mono-label">Смотреть как</span>
      <select value={viewerId} onChange={(e) => onChange(e.target.value)}>
        {users.map((user) => (
          <option key={user.id} value={user.id}>
            {user.role === 'owner' ? 'Собственник' : fullName(user)}
          </option>
        ))}
      </select>
    </label>
  )
}
