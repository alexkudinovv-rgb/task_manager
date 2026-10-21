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

// Mirrors the server policy (apps/server/src/auth/password.ts) for instant feedback; the server still decides.
const MIN_PASSWORD = 10

function localPasswordProblem(password: string, repeat: string, login: string): string | null {
  if (password.length < MIN_PASSWORD) return `Пароль должен быть не короче ${MIN_PASSWORD} символов.`
  if (password.trim().toLowerCase() === login.toLowerCase()) return 'Пароль не должен совпадать с логином.'
  if (password !== repeat) return 'Пароли не совпадают.'
  return null
}

/** Two steps: first the password, then the authenticator app with the code right under the QR. */
function InviteForm({ token, info, onAccepted, onInvalid }: FormProps) {
  const [step, setStep] = useState<1 | 2>(1)
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [code, setCode] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const action = useAction()

  function next(e: FormEvent) {
    e.preventDefault()
    const problem = localPasswordProblem(password, repeat, info.login)
    setPasswordError(problem)
    if (!problem) setStep(2)
  }

  function finish(e: FormEvent) {
    e.preventDefault()
    void action.run(async () => {
      const parsed = TotpCode.safeParse(code)
      if (!parsed.success) throw new FormError('Введите 6 цифр из приложения-аутентификатора.')
      try {
        onAccepted(await serverApi.acceptInvite(token, { password, code: parsed.data }))
      } catch (error) {
        if (errorCode(error) === 'invite_invalid') onInvalid(error)
        if (errorCode(error) === 'weak_password') {
          setPasswordError(errorMessage(error))
          setStep(1)
          return
        }
        throw error
      }
    })
  }

  return (
    <AuthShell
      title={`${info.firstName}, добро пожаловать`}
      lead={
        <>
          Ваш логин — <b className="mono-inline">{info.login}</b>. Два коротких шага, и вы в системе.
        </>
      }
    >
      <ol className="auth-progress" aria-label="Шаги">
        <li className={step === 1 ? 'is-current' : 'is-done'}>Пароль</li>
        <li className={step === 2 ? 'is-current' : undefined}>Код из приложения</li>
      </ol>

      {step === 1 ? (
        <form className="form" onSubmit={next} noValidate>
          <Field label="Придумайте пароль" hint={`Не короче ${MIN_PASSWORD} символов и не совпадает с логином.`}>
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Field label="Повторите пароль">
            <input className="input" type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
          </Field>
          {passwordError && (
            <div className="error-note" role="alert">
              <p>{passwordError}</p>
            </div>
          )}
          <button type="submit" className="btn btn-primary btn-block">
            Далее
          </button>
        </form>
      ) : (
        <form className="form" onSubmit={finish} noValidate>
          <p className="muted">
            Откройте Яндекс Ключ, Google Authenticator или другое приложение с одноразовыми кодами и отсканируйте QR-код.
          </p>
          <TotpQr uri={info.otpauthUri} />
          <a className="btn btn-secondary btn-block" href={info.otpauthUri}>
            Добавить в приложение на этом телефоне
          </a>
          <details className="secret-manual">
            <summary>Не сканируется? Ввести ключ вручную</summary>
            <div className="secret">
              <code className="secret-groups" aria-label="Ключ">
                {groupSecret(info.totpSecret).map((group, i) => (
                  <span key={i} className="secret-group">
                    {group}
                  </span>
                ))}
              </code>
              <CopyButton text={info.totpSecret} />
            </div>
          </details>

          <Field label="Код из приложения — 6 цифр">
            <input
              className="input code-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            />
          </Field>

          <ErrorNote error={action.error} />
          <div className="auth-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setStep(1)} disabled={action.busy}>
              Назад
            </button>
            <button type="submit" className="btn btn-primary" disabled={action.busy}>
              {action.busy ? 'Сохраняем…' : 'Готово'}
            </button>
          </div>
        </form>
      )}
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

/** Groups of four never split across lines, so the key reads as "JBSW Y3DP EHPK 3PXP". */
function groupSecret(secret: string): string[] {
  return secret.match(/.{1,4}/g) ?? []
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
