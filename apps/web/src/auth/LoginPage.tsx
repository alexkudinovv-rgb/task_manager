import { useState, type FormEvent } from 'react'
import { LoginInput, TotpCode, type UserDto, type VerifyInput } from '@car-city/shared/model'
import { serverApi } from '../api'
import { FormError, errorCode } from '../api/errors'
import { ErrorNote, Field, useAction } from '../components/ui'
import { AuthShell } from './AuthShell'

type Step = { kind: 'password' } | { kind: 'code'; challenge: string }

interface Props {
  onSignedIn: (me: UserDto) => void
  /** Shown above the form, e.g. after the session expired. */
  notice?: string | null
}

export function LoginPage({ onSignedIn, notice }: Props) {
  const [step, setStep] = useState<Step>({ kind: 'password' })
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [useRecovery, setUseRecovery] = useState(false)
  const action = useAction()

  function submitPassword(e: FormEvent) {
    e.preventDefault()
    void action.run(async () => {
      const parsed = LoginInput.safeParse({ login, password })
      if (!parsed.success) throw new FormError(login.trim() && password ? parsed.error.issues[0].message : 'Введите логин и пароль.')
      const { challenge } = await serverApi.login(parsed.data)
      setCode('')
      setStep({ kind: 'code', challenge })
    })
  }

  function submitCode(e: FormEvent, challenge: string) {
    e.preventDefault()
    void action.run(async () => {
      const value = code.trim()
      let input: VerifyInput
      if (useRecovery) {
        if (!value) throw new FormError('Введите резервный код.')
        input = { challenge, recoveryCode: value }
      } else {
        const parsed = TotpCode.safeParse(value)
        if (!parsed.success) throw new FormError('Код из приложения — 6 цифр.')
        input = { challenge, code: parsed.data }
      }
      try {
        const { me } = await serverApi.verify(input)
        onSignedIn(me)
      } catch (error) {
        // The 5-minute challenge is gone: start over from the password.
        if (errorCode(error) === 'challenge_expired') backToPassword()
        throw error
      }
    })
  }

  function backToPassword() {
    setStep({ kind: 'password' })
    setPassword('')
    setCode('')
    setUseRecovery(false)
  }

  if (step.kind === 'code') {
    return (
      <AuthShell
        title="Код подтверждения"
        lead={
          useRecovery
            ? 'Введите один из резервных кодов, которые вы сохранили при первом входе. Каждый код работает один раз.'
            : 'Откройте приложение-аутентификатор и введите 6 цифр для Car City.'
        }
      >
        <form className="form" onSubmit={(e) => submitCode(e, step.challenge)} noValidate>
          {useRecovery ? (
            <Field label="Резервный код">
              <input className="input mono-input" autoComplete="off" autoFocus value={code} onChange={(e) => setCode(e.target.value)} />
            </Field>
          ) : (
            <Field label="Код из приложения">
              <input
                className="input code-input"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              />
            </Field>
          )}
          <ErrorNote error={action.error} />
          <button type="submit" className="btn btn-primary btn-block" disabled={action.busy}>
            {action.busy ? 'Проверяем…' : 'Войти'}
          </button>
          <div className="form-links">
            <button
              type="button"
              className="link-button"
              onClick={() => {
                setUseRecovery(!useRecovery)
                setCode('')
                action.clear()
              }}
            >
              {useRecovery ? 'Ввести код из приложения' : 'Использовать резервный код'}
            </button>
            <button type="button" className="link-button" onClick={backToPassword}>
              Назад
            </button>
          </div>
        </form>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="Вход">
      <form className="form" onSubmit={submitPassword} noValidate>
        {notice && !action.error && <p className="form-notice">{notice}</p>}
        <Field label="Логин">
          <input
            className="input"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
            value={login}
            onChange={(e) => setLogin(e.target.value)}
          />
        </Field>
        <Field label="Пароль">
          <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <ErrorNote error={action.error} />
        <button type="submit" className="btn btn-primary btn-block" disabled={action.busy}>
          {action.busy ? 'Проверяем…' : 'Далее'}
        </button>
        <p className="muted">Регистрации нет: доступ выдаёт администратор ссылкой-приглашением.</p>
      </form>
    </AuthShell>
  )
}
