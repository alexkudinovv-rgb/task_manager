import type { Department } from '../domain'
import { ChatIcon } from './TaskParts'

interface Props {
  departments: { department: Department; count: number }[]
  activeDepartmentId: string | null
  onSelectDepartment: (id: string | null) => void
  taskCount: number
}

const SOON = 'Появится в следующих версиях'

export function Sidebar({ departments, activeDepartmentId, onSelectDepartment, taskCount }: Props) {
  return (
    <nav className="sidebar" aria-label="Разделы">
      <div className="sidebar-brand">
        <img src={`${import.meta.env.BASE_URL}logo.png`} alt="" width="40" height="40" />
        <div>
          <span className="sidebar-brand-name">Car City</span>
          <span className="sidebar-brand-sub">Задачи</span>
        </div>
      </div>

      <div className="sidebar-main">
        <a className="sidebar-link is-active" href="#" aria-current="page" onClick={() => onSelectDepartment(null)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="3" width="7" height="18" rx="2" />
            <rect x="14" y="3" width="7" height="11" rx="2" />
          </svg>
          Задачи
          <span className="sidebar-count">{taskCount}</span>
        </a>
        <span className="sidebar-link is-soon" title={SOON} aria-disabled="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 3v18h18" />
            <path d="M7 15l4-4 3 3 5-6" />
          </svg>
          Обзор собственника
        </span>
        <span className="sidebar-link is-soon" title={SOON} aria-disabled="true">
          <ChatIcon size={18} />
          Общий чат
        </span>
        <span className="sidebar-link is-soon" title={SOON} aria-disabled="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 12h4l2-6 4 12 2-6h6" />
          </svg>
          Пульс
        </span>
        <span className="sidebar-link is-soon" title={SOON} aria-disabled="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 6h10M4 12h16M4 18h7" />
          </svg>
          Роадмап
        </span>
      </div>

      <div className="sidebar-departments">
        <div className="sidebar-divider" />
        <span className="sidebar-section">Отделы</span>
        {departments.map(({ department, count }) => (
          <button
            key={department.id}
            type="button"
            className={`sidebar-sublink${activeDepartmentId === department.id ? ' is-active' : ''}`}
            aria-pressed={activeDepartmentId === department.id}
            onClick={() => onSelectDepartment(activeDepartmentId === department.id ? null : department.id)}
          >
            {department.name}
            <span className="sidebar-count">{count}</span>
          </button>
        ))}
      </div>
    </nav>
  )
}
