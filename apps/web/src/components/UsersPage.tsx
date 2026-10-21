import { useState, type FormEvent } from 'react'
import { CreateUserInput, type InviteLinkResponse, type UserDto, type WorkspaceDto } from '@car-city/shared/model'
import { serverApi } from '../api'
import { FormError } from '../api/errors'
import { byName, fullName, type Lookup } from '../workspace'
import { Avatar } from './TaskParts'
import { CopyButton, ErrorNote, Field, formatMoment, useAction } from './ui'

interface Props {
  workspace: WorkspaceDto
  lookup: Lookup
  onChanged: () => Promise<void>
}

interface IssuedInvite {
  user: UserDto
  link: InviteLinkResponse
}

/** Admin screen: everyone in the directory, new users and invite links. */
export function UsersPage({ workspace, lookup, onChanged }: Props) {
  const [creating, setCreating] = useState(false)
  const [invite, setInvite] = useState<IssuedInvite | null>(null)
  const users = [...workspace.users].sort((a, b) => Number(a.disabled) - Number(b.disabled) || byName(a, b))

  return (
    <>
      <header className="page-head">
        <div className="page-head-title">
          <span className="mono-label with-checker">Только для администраторов</span>
          <h1>
            <span className="marker">Пользователи</span>
          </h1>
        </div>
        <div className="page-head-actions">
          <button type="button" className="btn btn-primary" onClick={() => setCreating(!creating)}>
            {creating ? 'Скрыть форму' : 'Добавить пользователя'}
          </button>
        </div>
      </header>

      {invite && <InviteLinkCard invite={invite} onClose={() => setInvite(null)} />}

      {creating && (
        <CreateUserForm
          workspace={workspace}
          onCreated={async (created) => {
            setInvite({ user: created.user, link: created })
            setCreating(false)
            await onChanged()
          }}
        />
      )}

      <section className="card users" aria-label="Пользователи">
        {users.map((user) => (
          <UserRow
            key={user.id}
            user={user}
            me={workspace.me}
            lookup={lookup}
            onInvite={(link) => setInvite({ user, link })}
            onChanged={onChanged}
          />
        ))}
      </section>
    </>
  )
}

function InviteLinkCard({ invite, onClose }: { invite: IssuedInvite; onClose: () => void }) {
  return (
    <section className="card invite-card" aria-live="polite">
      <div className="invite-card-head">
        <h2>Ссылка-приглашение для {fullName(invite.user)}</h2>
        <button type="button" className="panel-close" aria-label="Скрыть" onClick={onClose}>
          ✕
        </button>
      </div>
      <p className="muted">
        Отправьте её лично. По ссылке пользователь задаст пароль и подключит код из приложения. Действует до{' '}
        {formatMoment(invite.link.expiresAt)}, сработает один раз.
      </p>
      <div className="secret">
        <input className="input mono-input" readOnly value={invite.link.inviteUrl} onFocus={(e) => e.target.select()} aria-label="Ссылка-приглашение" />
        <CopyButton text={invite.link.inviteUrl} />
      </div>
    </section>
  )
}

interface CreateProps {
  workspace: WorkspaceDto
  onCreated: (created: { user: UserDto } & InviteLinkResponse) => Promise<void>
}

function CreateUserForm({ workspace, onCreated }: CreateProps) {
  const [login, setLogin] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [positionId, setPositionId] = useState('')
  const [unitId, setUnitId] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  const action = useAction()

  function submit(e: FormEvent) {
    e.preventDefault()
    void action.run(async () => {
      if (!firstName.trim() || !lastName.trim()) throw new FormError('Введите имя и фамилию.')
      const parsed = CreateUserInput.safeParse({
        login,
        firstName,
        lastName,
        positionId: positionId || null,
        unitId: unitId || null,
        isAdmin,
      })
      if (!parsed.success) throw new FormError(parsed.error.issues[0].message)
      await onCreated(await serverApi.createUser(parsed.data))
    })
  }

  return (
    <section className="card form-card">
      <h2 className="form-card-title">Новый пользователь</h2>
      <form className="form" onSubmit={submit} noValidate>
        <div className="field-row">
          <Field label="Имя">
            <input className="input" maxLength={60} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </Field>
          <Field label="Фамилия">
            <input className="input" maxLength={60} value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </Field>
        </div>
        <Field label="Логин" hint="Латиница в нижнем регистре, например belova.">
          <input
            className="input"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={32}
            value={login}
            onChange={(e) => setLogin(e.target.value)}
          />
        </Field>
        <div className="field-row">
          <Field label="Должность">
            <select className="input" value={positionId} onChange={(e) => setPositionId(e.target.value)}>
              <option value="">Не указана</option>
              {workspace.positions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Подразделение">
            <select className="input" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
              <option value="">Не указано</option>
              {workspace.units.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <label className="check-row">
          <input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} />
          Администратор — может заводить пользователей
        </label>
        <ErrorNote error={action.error} />
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={action.busy}>
            {action.busy ? 'Создаём…' : 'Создать и получить ссылку'}
          </button>
        </div>
      </form>
    </section>
  )
}

interface RowProps {
  user: UserDto
  me: UserDto
  lookup: Lookup
  onInvite: (link: InviteLinkResponse) => void
  onChanged: () => Promise<void>
}

function UserRow({ user, me, lookup, onInvite, onChanged }: RowProps) {
  const action = useAction()
  const name = fullName(user)
  const position = user.positionId ? lookup.positions.get(user.positionId)?.name : null
  const unit = user.unitId ? lookup.units.get(user.unitId)?.name : null
  const isOwner = user.role === 'owner'

  function reinvite() {
    const ok = window.confirm(
      `Создать новую ссылку-приглашение для ${name}?\n\nТекущий пароль и код из приложения перестанут работать — пользователю придётся заново пройти настройку по ссылке.`,
    )
    if (!ok) return
    void action.run(async () => {
      onInvite(await serverApi.reinviteUser(user.id))
      await onChanged()
    })
  }

  function toggleAdmin() {
    void action.run(async () => {
      await serverApi.updateUser(user.id, { isAdmin: !user.isAdmin })
      await onChanged()
    })
  }

  function disable() {
    if (!window.confirm(`Отключить ${name}? Пользователь сразу выйдет на всех устройствах и больше не сможет войти.`)) return
    void action.run(async () => {
      await serverApi.disableUser(user.id)
      await onChanged()
    })
  }

  return (
    <div className={`user-row${user.disabled ? ' is-disabled' : ''}`}>
      <Avatar user={user} />
      <div className="user-row-main">
        <span className="user-row-name">
          {name}
          {user.id === me.id && <span className="muted"> · это вы</span>}
        </span>
        <span className="muted">
          <span className="mono">{user.login}</span>
          {position && ` · ${position}`}
          {unit && ` · ${unit}`}
        </span>
        <span className="task-tags">
          {isOwner && <span className="tag tag-hot">Собственник</span>}
          {user.isAdmin && <span className="tag">Администратор</span>}
          {user.disabled && <span className="tag tag-cancelled">Отключён</span>}
        </span>
        <ErrorNote error={action.error} />
      </div>
      <div className="user-row-actions">
        <button type="button" className="chip" disabled={action.busy} onClick={reinvite}>
          Новая ссылка-приглашение
        </button>
        {!isOwner && !user.disabled && (
          <button type="button" className="chip" disabled={action.busy} onClick={toggleAdmin}>
            {user.isAdmin ? 'Снять администратора' : 'Сделать администратором'}
          </button>
        )}
        {!user.disabled && user.id !== me.id && !isOwner && (
          <button type="button" className="chip chip-danger" disabled={action.busy} onClick={disable}>
            Отключить
          </button>
        )}
      </div>
    </div>
  )
}
