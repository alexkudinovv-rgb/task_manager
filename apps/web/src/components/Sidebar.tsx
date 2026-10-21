import type { DirectoryItem, UserDto } from '@car-city/shared/model'
import { fullName } from '../workspace'
import { ChatIcon } from './TaskParts'

export type Section = 'tasks' | 'users'

interface Props {
  section: Section
  onSection: (section: Section) => void
  /** Admins see «Пользователи» (real mode only). */
  canManageUsers: boolean
  units: { unit: DirectoryItem; count: number }[]
  activeUnitId: string | null
  onSelectUnit: (id: string | null) => void
  taskCount: number
  /** Signed-in user; null in the demo. */
  me: UserDto | null
  onLogout: () => void
  onLogoutAll: () => void
}

const SOON = 'Появится в следующих версиях'

export function Sidebar(props: Props) {
  const { section, onSection, canManageUsers, units, activeUnitId, onSelectUnit, taskCount, me } = props
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
        <button
          type="button"
          className={`sidebar-link${section === 'tasks' ? ' is-active' : ''}`}
          aria-current={section === 'tasks' ? 'page' : undefined}
          onClick={() => {
            onSection('tasks')
            onSelectUnit(null)
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="3" width="7" height="18" rx="2" />
            <rect x="14" y="3" width="7" height="11" rx="2" />
          </svg>
          Задачи
          <span className="sidebar-count">{taskCount}</span>
        </button>
        {canManageUsers && (
          <button
            type="button"
            className={`sidebar-link${section === 'users' ? ' is-active' : ''}`}
            aria-current={section === 'users' ? 'page' : undefined}
            onClick={() => onSection('users')}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="9" cy="8" r="3.5" />
              <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5" />
            </svg>
            Пользователи
          </button>
        )}
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

      <div className="sidebar-units">
        <div className="sidebar-divider" />
        <span className="sidebar-section">Подразделения</span>
        {units.map(({ unit, count }) => (
          <button
            key={unit.id}
            type="button"
            className={`sidebar-sublink${activeUnitId === unit.id ? ' is-active' : ''}${count === 0 ? ' is-empty' : ''}`}
            aria-pressed={activeUnitId === unit.id}
            onClick={() => {
              onSection('tasks')
              onSelectUnit(activeUnitId === unit.id ? null : unit.id)
            }}
          >
            {unit.name}
            <span className="sidebar-count">{count}</span>
          </button>
        ))}
      </div>

      {me && (
        <div className="sidebar-user">
          <div className="sidebar-divider" />
          <div className="sidebar-user-name">
            {fullName(me)}
            <span className="sidebar-brand-sub">{me.login}</span>
          </div>
          <button type="button" className="sidebar-sublink" onClick={props.onLogout}>
            Выйти
          </button>
          <button type="button" className="sidebar-sublink" onClick={props.onLogoutAll}>
            Выйти на всех устройствах
          </button>
        </div>
      )}
    </nav>
  )
}
