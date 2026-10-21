import { useEffect, useState } from 'react'
import type { UserDto } from '@car-city/shared/model'
import { DEMO, serverApi } from './api'
import { errorMessage, isUnauthorized } from './api/errors'
import { setUnauthorizedHandler } from './api/http'
import { InvitePage } from './auth/InvitePage'
import { LoginPage } from './auth/LoginPage'
import { MainScreen } from './components/MainScreen'
import { inviteTokenFromPath, replaceWithHome } from './routes'

export function App() {
  // The GitHub Pages demo has no server: mock data, no login.
  if (DEMO) return <MainScreen onSignedOut={() => {}} />
  return <LiveApp />
}

type Session =
  | { kind: 'loading' }
  | { kind: 'failed'; error: unknown }
  | { kind: 'anon'; expired?: boolean }
  | { kind: 'user'; me: UserDto }

function LiveApp() {
  const [inviteToken, setInviteToken] = useState(inviteTokenFromPath)
  const [session, setSession] = useState<Session>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)

  // Any 401 outside the auth flow means the session ended: back to the login screen.
  useEffect(() => {
    setUnauthorizedHandler(() => setSession({ kind: 'anon', expired: true }))
    return () => setUnauthorizedHandler(null)
  }, [])

  useEffect(() => {
    if (inviteTokenFromPath()) return
    let ignore = false
    serverApi.me().then(
      ({ me }) => !ignore && setSession({ kind: 'user', me }),
      (error: unknown) => !ignore && setSession(isUnauthorized(error) ? { kind: 'anon' } : { kind: 'failed', error }),
    )
    return () => {
      ignore = true
    }
  }, [attempt])

  if (inviteToken) {
    return (
      <InvitePage
        token={inviteToken}
        onDone={(me) => {
          replaceWithHome()
          setInviteToken(null)
          setSession({ kind: 'user', me })
        }}
      />
    )
  }

  switch (session.kind) {
    case 'loading':
      return <p className="app-message">Загрузка…</p>
    case 'failed':
      return (
        <div className="app-message">
          <p>Не удалось связаться с сервером. {errorMessage(session.error)}</p>
          <button type="button" className="btn btn-secondary" onClick={() => setAttempt(attempt + 1)}>
            Повторить
          </button>
        </div>
      )
    case 'anon':
      return (
        <LoginPage
          notice={session.expired ? 'Сессия закончилась — войдите снова.' : null}
          onSignedIn={(me) => setSession({ kind: 'user', me })}
        />
      )
    case 'user':
      return <MainScreen key={session.me.id} onSignedOut={() => setSession({ kind: 'anon' })} />
  }
}
