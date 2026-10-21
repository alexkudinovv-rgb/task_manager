import { useEffect, useState, type FormEvent } from 'react'
import QRCode from 'qrcode'
import { TotpCode, type AcceptInviteResponse, type InviteInfo, type UserDto } from '@car-city/shared/model'
import { serverApi } from '../api'
import { FormError, errorCode, errorMessage } from '../api/errors'
import { CopyButton, ErrorNote, Field, useAction } from '../components/ui'
import { AuthShell } from './AuthShell'

type State =
  | { kind: 'loading' }
  | { kind: 'failed'; error: unknown }
  | { kind: 'form'; info: InviteInfo }
  | { kind: 'codes'; result: AcceptInviteResponse }

interface Props {
  token: string
  /** After the recovery codes are confirmed; the session cookie is already set. */
  onDone: (me: UserDto) => void
}

export function InvitePage({ token, onDone }: Props) {
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let ignore = false
    serverApi.invite(token).then(
      (info) => !ignore && setState({ kind: 'form', info }),
      (error: unknown) => !ignore && setState({ kind: 'failed', error }),
    )
    return () => {
      ignore = true
    }
  }, [token, attempt])

  if (state.kind === 'loading') {
    return (
      <AuthShell title="Приглашение">
        <p className="muted">Загружаем…</p>
      </AuthShell>
    )
  }

  if (state.kind === 'failed') {
    const invalid = errorCode(state.error) === 'invite_invalid' || errorCode(state.error) === 'not_found'
    return (
      <AuthShell title="Приглашение">
        <div className="error-note" role="alert">
          <p>{invalid ? 'Ссылка недействительна, попросите новую у администратора.' : errorMessage(state.error)}</p>
        </div>
        {!invalid && (
          <button type="button" className="btn btn-secondary" onClick={() => setAttempt(attempt + 1)}>
            Повторить
          </button>
        )}
      </AuthShell>
    )
  }

  if (state.kind === 'codes') {
    return <RecoveryCodes codes={state.result.recoveryCodes} onConfirm={() => onDone(state.result.me)} />
  }

  return (
    <InviteForm
      token={token}
      info={state.info}
      onAccepted={(result) => setState({ kind: 'codes', result })}
      onInvalid={(error) => setState({ kind: 'failed', error })}
    />
  )
}

interface FormProps {
  token: string
  info: InviteInfo
  onAccepted: (result: AcceptInviteResponse) => void
  onInvalid: (error: unknown) => void
}

function InviteForm({ token, info, onAccepted, onInvalid }: FormProps) {
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [code, setCode] = useState('')
  const action = useAction()

  function submit(e: FormEvent) {
    e.preventDefault()
    void action.run(async () => {
      if (!password) throw new FormError('Придумайте пароль.')
      if (password !== repeat) throw new FormError('Пароли не совпадают.')
      const parsed = TotpCode.safeParse(code)
      if (!parsed.success) throw new FormError('Введите 6 цифр из приложения-аутентификатора.')
      try {
        onAccepted(await serverApi.acceptInvite(token, { password, code: parsed.data }))
      } catch (error) {
        if (errorCode(error) === 'invite_invalid') onInvalid(error)
        throw error
      }
    })
  }

  return (
    <AuthShell
      title={`${info.firstName}, добро пожаловать`}
      lead={
        <>
          Ваш логин — <b className="mono-inline">{info.login}</b>. Осталось придумать пароль и подключить код из приложения.
        </>
      }
    >
      <form className="form" onSubmit={submit} noValidate>
        <section className="auth-step">
          <span className="mono-label">1 · Приложение-аутентификатор</span>
          <p className="muted">
            Установите Яндекс Ключ, Google Authenticator или другое приложение с одноразовыми кодами и отсканируйте QR-код.
          </p>
          <TotpQr uri={info.otpauthUri} />
          <p className="muted">Не сканируется? Добавьте ключ вручную:</p>
          <div className="secret">
            <code>{groupSecret(info.totpSecret)}</code>
            <CopyButton text={info.totpSecret} />
          </div>
        </section>

        <section className="auth-step">
          <span className="mono-label">2 · Пароль</span>
          <Field label="Пароль" hint="Не короче 10 символов и не совпадает с логином.">
            <input className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Field label="Повторите пароль">
            <input className="input" type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
          </Field>
        </section>

        <section className="auth-step">
          <span className="mono-label">3 · Код из приложения</span>
          <Field label="6 цифр">
            <input
              className="input code-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            />
          </Field>
        </section>

        <ErrorNote error={action.error} />
        <button type="submit" className="btn btn-primary btn-block" disabled={action.busy}>
          {action.busy ? 'Сохраняем…' : 'Завершить настройку'}
        </button>
      </form>
    </AuthShell>
  )
}

function TotpQr({ uri }: { uri: string }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let ignore = false
    QRCode.toDataURL(uri, { margin: 1, width: 208, errorCorrectionLevel: 'M' }).then(
      (url) => !ignore && setSrc(url),
      () => !ignore && setSrc(null),
    )
    return () => {
      ignore = true
    }
  }, [uri])

  return <div className="qr">{src ? <img src={src} alt="QR-код для приложения-аутентификатора" width="208" height="208" /> : null}</div>
}

/** "JBSW Y3DP EHPK 3PXP" reads easier when typed by hand. */
function groupSecret(secret: string): string {
  return secret.replace(/(.{4})/g, '$1 ').trim()
}

function RecoveryCodes({ codes, onConfirm }: { codes: string[]; onConfirm: () => void }) {
  // The codes are shown once: warn before the tab is closed or reloaded.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])

  return (
    <AuthShell
      title="Резервные коды"
      lead="Сохраните их в надёжном месте. Если телефон потеряется, любой из кодов заменит код из приложения — один раз. Больше мы их не покажем."
    >
      <ol className="codes">
        {codes.map((code) => (
          <li key={code} className="mono">
            {code}
          </li>
        ))}
      </ol>
      <div className="form">
        <CopyButton text={codes.join('\n')} label="Скопировать все коды" />
        <button type="button" className="btn btn-primary btn-block" onClick={onConfirm}>
          Я сохранил коды
        </button>
      </div>
    </AuthShell>
  )
}
