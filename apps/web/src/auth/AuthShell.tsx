import type { ReactNode } from 'react'

/** Centered Car City card for the screens before the app: login and invite. */
export function AuthShell({ title, lead, children }: { title: ReactNode; lead?: ReactNode; children: ReactNode }) {
  return (
    <div className="auth">
      <div className="card auth-card">
        <div className="auth-brand">
          <img src={`${import.meta.env.BASE_URL}logo.png`} alt="" width="40" height="40" />
          <div>
            <span className="auth-brand-name">Car City</span>
            <span className="mono-label auth-brand-sub">Задачи</span>
          </div>
        </div>
        <h1 className="auth-title">{title}</h1>
        {lead && <p className="auth-lead">{lead}</p>}
        {children}
      </div>
    </div>
  )
}
