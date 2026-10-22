import { useEffect, useState } from 'react'
import type { DirectoryItem, UserDto } from '@car-city/shared/model'
import { LOGO_URL } from '../brand'
import { fullName } from '../workspace'
import { ChatIcon } from './TaskParts'

export type Section = 'tasks' | 'users' | 'settings' | 'chat'

interface Props {
  section: Section
  onSection: (section: Section) => void
  /** Admins see «Пользователи» (real mode only). */
  canManageUsers: boolean
  units: { unit: DirectoryItem; count: number }[]
  activeUnitId: string | null
  onSelectUnit: (id: string | null) => void
  taskCount: number
  /** Unread messages in the general chat. */
  chatUnread: number
  /** Signed-in user; null in the demo. */
  me: UserDto | null
  onLogout: () => void
  onLogoutAll: () => void
}

const SOON = 'Появится в следующих версиях'

const SECTION_TITLES: Record<Section, string> = {
  tasks: 'Задачи',
  users: 'Пользователи',
  settings: 'Уведомления',
  chat: 'Общий чат',
}

/** Sections on the left; on a phone a slim top bar whose menu button slides the same panel in. */
export function Sidebar(props: Props) {
  const { section, chatUnread } = props
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('keydown', onKey)
    // The page under the drawer stays put while it is open.
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open])

  return (
    <>
      <header className="mobile-bar">
        <button
          type="button"
          className="mobile-bar-menu"
          aria-label={chatUnread > 0 ? `Меню, непрочитанных в общем чате: ${chatUnread}` : 'Меню'}
          aria-expanded={open}
          aria-controls="app-sidebar"
          onClick={() => setOpen(true)}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
          {chatUnread > 0 && <span className="mobile-bar-dot" aria-hidden="true" />}
        </button>
        <img src={LOGO_URL} alt="" width="32" height="32" />
        <span className="mobile-bar-title">{SECTION_TITLES[section]}</span>
      </header>
      {open && <div className="sidebar-backdrop" aria-hidden="true" onClick={() => setOpen(false)} />}
      <nav
        id="app-sidebar"
        className={`sidebar${open ? ' is-open' : ''}`}
        aria-label="Разделы"
        // On a phone any choice in the drawer also closes it.
        onClick={(e) => (e.target as HTMLElement).closest('button') && setOpen(false)}
      >
        <SidebarContent {...props} />
      </nav>
    </>
  )
}

function SidebarContent(props: Props) {
  const { section, onSection, canManageUsers, units, activeUnitId, onSelectUnit, taskCount, chatUnread, me } = props
  return (
    <>
      <div className="sidebar-brand">
        <img src={LOGO_URL} alt="" width="40" height="40" />
        <div>
          <span className="sidebar-brand-name">Car City</span>
          <span className="sidebar-brand-sub">Задачи</span>
        </div>
        <button type="button" className="sidebar-close" aria-label="Закрыть меню">
          ✕
        </button>
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
        <button
          type="button"
          className={`sidebar-link${section === 'settings' ? ' is-active' : ''}`}
          aria-current={section === 'settings' ? 'page' : undefined}
          onClick={() => onSection('settings')}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
            <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
          </svg>
          Уведомления
        </button>
        <span className="sidebar-link is-soon" title={SOON} aria-disabled="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 3v18h18" />
            <path d="M7 15l4-4 3 3 5-6" />
          </svg>
          Обзор собственника
        </span>
        <button
          type="button"
          className={`sidebar-link${section === 'chat' ? ' is-active' : ''}`}
          aria-current={section === 'chat' ? 'page' : undefined}
          onClick={() => onSection('chat')}
        >
          <ChatIcon size={18} />
          Общий чат
          {chatUnread > 0 && (
            <span className="sidebar-count" aria-label={`Непрочитанных: ${chatUnread}`}>
              {chatUnread}
            </span>
          )}
        </button>
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
    </>
  )
}
