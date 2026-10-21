import { useEffect, useMemo, useState } from 'react'
import { api, type User, type Workspace } from './api'
import { BoardView } from './components/BoardView'
import { ListView } from './components/ListView'
import { Sidebar } from './components/Sidebar'
import { TaskPanel } from './components/TaskPanel'
import { buildLookup, byUrgency, canViewerSee, fullName, resolveTask, type Lookup } from './workspace'

type View = 'board' | 'list'
type QuickFilter = 'all' | 'hot' | 'overdue'

const VIEWS: { id: View; label: string; title: [string, string] }[] = [
  { id: 'board', label: 'Канбан', title: ['Доска', 'задач'] },
  { id: 'list', label: 'Список', title: ['Все', 'задачи'] },
]

export function App() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    api.loadWorkspace().then(setWorkspace, (error: unknown) => setLoadError(String(error)))
  }, [])

  const lookup = useMemo(() => (workspace ? buildLookup(workspace, new Date()) : null), [workspace])

  if (loadError) return <p className="app-message">Не удалось загрузить задачи: {loadError}</p>
  if (!workspace || !lookup) return <p className="app-message">Загрузка…</p>
  return <TasksPage workspace={workspace} lookup={lookup} />
}

function TasksPage({ workspace, lookup }: { workspace: Workspace; lookup: Lookup }) {
  const owner = workspace.users.find((user) => user.role === 'owner')!
  const [viewerId, setViewerId] = useState(owner.id)
  const [view, setView] = useState<View>('board')
  const [quick, setQuick] = useState<QuickFilter>('all')
  const [unitId, setUnitId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [showDone, setShowDone] = useState(false)
  const [openTaskId, setOpenTaskId] = useState<string | null>(null)

  const viewer = lookup.users.get(viewerId) ?? owner
  // Subtasks live inside their parent's panel, not on the board.
  const visible = workspace.tasks
    .filter((task) => task.parentId === null && canViewerSee(viewer, task, lookup))
    .map((task) => resolveTask(task, lookup))

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

  const unitCounts = workspace.units.map((unit) => ({
    unit,
    count: visible.filter((v) => v.unit?.id === unit.id).length,
  }))
  const current = VIEWS.find((v) => v.id === view)!
  const quickFilters: { id: QuickFilter; label: string; count: number }[] = [
    { id: 'all', label: 'Все', count: scoped.length },
    { id: 'hot', label: 'Горит', count: scoped.filter((v) => v.hot).length },
    { id: 'overdue', label: 'Просрочено', count: scoped.filter((v) => v.overdue).length },
  ]
  const openView = visible.find((v) => v.task.id === openTaskId)

  return (
    <div className="app">
      <Sidebar units={unitCounts} activeUnitId={unitId} onSelectUnit={setUnitId} taskCount={visible.length} />

      <main className="main">
        <header className="page-head">
          <div className="page-head-title">
            <span className="mono-label with-checker">Тестовая версия · подставные данные</span>
            <h1>
              {current.title[0]} <span className="marker">{current.title[1]}</span>
            </h1>
          </div>
          <div className="page-head-actions">
            <ViewerSwitch users={workspace.users} viewerId={viewer.id} onChange={setViewerId} />
            <label className="search">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="M20 20l-4-4" />
              </svg>
              <input type="search" placeholder="Найти задачу" aria-label="Найти задачу" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => window.alert('В тестовой версии задачи пока не создаются — появится вместе с сервером.')}
            >
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
            <button type="button" className="chip" onClick={() => setUnitId(null)}>
              {lookup.units.get(unitId)?.name} ✕
            </button>
          )}
        </div>

        {view === 'board' ? (
          <BoardView views={shown} onOpen={setOpenTaskId} />
        ) : (
          <ListView units={workspace.units} views={shown} onOpen={setOpenTaskId} />
        )}
      </main>

      {openView && (
        <TaskPanel key={openView.task.id} view={openView} viewer={viewer} lookup={lookup} onClose={() => setOpenTaskId(null)} />
      )}
    </div>
  )
}

/** Demo-only: look at the board through someone else's eyes; visibility follows canSee. */
function ViewerSwitch({ users, viewerId, onChange }: { users: User[]; viewerId: string; onChange: (id: string) => void }) {
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
