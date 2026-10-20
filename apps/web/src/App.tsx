import { useEffect, useMemo, useState } from 'react'
import { api, type Workspace } from './api'
import { toIsoDate } from './dates'
import type { Task } from './domain'
import { BoardView } from './components/BoardView'
import { ListView } from './components/ListView'
import { Sidebar } from './components/Sidebar'
import { resolveTask, type Lookup } from './components/TaskParts'

type View = 'board' | 'list'
type QuickFilter = 'all' | 'hot' | 'overdue'

const VIEWS: { id: View; label: string; title: [string, string] }[] = [
  { id: 'board', label: 'Канбан', title: ['Доска', 'задач'] },
  { id: 'list', label: 'Список', title: ['Все', 'задачи'] },
]

/** Hot first, then the nearest deadline. */
function byUrgency(a: Task, b: Task): number {
  return Number(b.isHot) - Number(a.isHot) || a.dueDate.localeCompare(b.dueDate)
}

export function App() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [view, setView] = useState<View>('board')
  const [quick, setQuick] = useState<QuickFilter>('all')
  const [departmentId, setDepartmentId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [showDone, setShowDone] = useState(false)

  useEffect(() => {
    api.loadWorkspace().then(setWorkspace, (error: unknown) => setLoadError(String(error)))
  }, [])

  const lookup = useMemo<Lookup | null>(() => {
    if (!workspace) return null
    return {
      today: toIsoDate(new Date()),
      statuses: new Map(workspace.statuses.map((s) => [s.id, s])),
      departments: new Map(workspace.departments.map((d) => [d.id, d])),
      users: new Map(workspace.users.map((u) => [u.id, u])),
    }
  }, [workspace])

  if (loadError) return <p className="app-message">Не удалось загрузить задачи: {loadError}</p>
  if (!workspace || !lookup) return <p className="app-message">Загрузка…</p>

  const needle = query.trim().toLowerCase()
  const scoped = workspace.tasks
    .filter((task) => !departmentId || task.departmentId === departmentId)
    .filter((task) => !needle || task.title.toLowerCase().includes(needle))
  const hotCount = scoped.filter((task) => resolveTask(task, lookup).hot).length
  const overdueCount = scoped.filter((task) => resolveTask(task, lookup).overdue).length
  const visible = scoped
    .filter((task) => {
      const resolved = resolveTask(task, lookup)
      if (quick === 'hot') return resolved.hot
      if (quick === 'overdue') return resolved.overdue
      return view === 'board' || showDone || !resolved.status.isFinal
    })
    .sort(byUrgency)

  const departmentCounts = workspace.departments.map((department) => ({
    department,
    count: workspace.tasks.filter((task) => task.departmentId === department.id).length,
  }))
  const current = VIEWS.find((v) => v.id === view)!
  const quickFilters: { id: QuickFilter; label: string; count: number }[] = [
    { id: 'all', label: 'Все', count: scoped.length },
    { id: 'hot', label: 'Горит', count: hotCount },
    { id: 'overdue', label: 'Просрочено', count: overdueCount },
  ]

  return (
    <div className="app">
      <Sidebar
        departments={departmentCounts}
        activeDepartmentId={departmentId}
        onSelectDepartment={setDepartmentId}
        taskCount={workspace.tasks.length}
      />

      <main className="main">
        <header className="page-head">
          <div className="page-head-title">
            <span className="mono-label with-checker">Тестовая версия · подставные данные</span>
            <h1>
              {current.title[0]} <span className="marker">{current.title[1]}</span>
            </h1>
          </div>
          <div className="page-head-actions">
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
              Показать готовые
            </button>
          )}
          {departmentId && (
            <button type="button" className="chip" onClick={() => setDepartmentId(null)}>
              Отдел: {lookup.departments.get(departmentId)?.name} ✕
            </button>
          )}
        </div>

        {view === 'board' ? (
          <BoardView statuses={workspace.statuses} tasks={visible} lookup={lookup} />
        ) : (
          <ListView departments={workspace.departments} tasks={visible} lookup={lookup} />
        )}
      </main>
    </div>
  )
}
