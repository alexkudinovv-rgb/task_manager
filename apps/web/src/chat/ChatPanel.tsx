import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { MESSAGE_EDIT_WINDOW_MS, type ChatKey, type MessageDto, type UserDto } from '@car-city/shared/model'
import { DEMO } from '../api'
import { chatApi } from '../api/server'
import { ErrorNote } from '../components/ui'
import { fullName, initials } from '../workspace'
import { Composer } from './Composer'
import { dayKey, formatDayLabel, formatFull, formatTime, renderBody } from './text'
import { useLive } from './useLive'
import './chat.css'

interface Props {
  chatKey: ChatKey
  /** Done task: history only, no composer, no edits. */
  readOnly?: boolean
  /** Directory for names and @mention suggestions; `me` may or may not be in it. */
  users: UserDto[]
  me: UserDto
}

// Consecutive messages of one author within this gap share a header.
const GROUP_GAP_MS = 5 * 60_000
const NEAR_TOP_PX = 80
const NEAR_BOTTOM_PX = 80
const READ_DELAY_MS = 600

const byTime = (a: MessageDto, b: MessageDto) =>
  a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0

/** Adds or replaces messages by id, oldest first. `insert: false` only replaces ones already shown. */
function upsert(list: MessageDto[], incoming: MessageDto[], insert = true): MessageDto[] {
  const byId = new Map(list.map((m) => [m.id, m]))
  for (const message of incoming) if (insert || byId.has(message.id)) byId.set(message.id, message)
  return [...byId.values()].sort(byTime)
}

/** Re-renders every `ms` so time-bound UI (the 15-minute edit window) stays honest. */
function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), ms)
    return () => window.clearInterval(timer)
  }, [ms])
  return now
}

const UNKNOWN: Omit<UserDto, 'id'> = {
  login: '',
  firstName: 'Неизвестный',
  lastName: 'пользователь',
  role: 'director',
  positionId: null,
  unitId: null,
  isAdmin: false,
  disabled: true,
}

/** A task chat or the general chat: history with paging up, live updates, composer, own-message edits. */
export function ChatPanel({ chatKey, readOnly = false, users, me }: Props) {
  const people = useMemo(() => new Map([...users, me].map((user) => [user.id, user])), [users, me])
  const byLogin = useMemo(() => new Map([...people.values()].map((user) => [user.login, user])), [people])
  const mentionable = useMemo(
    () => [...people.values()].filter((user) => !user.disabled && user.id !== me.id),
    [people, me.id],
  )

  const [messages, setMessages] = useState<MessageDto[]>([])
  const [nextBefore, setNextBefore] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [olderBusy, setOlderBusy] = useState(false)
  const [actionError, setActionError] = useState<unknown>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const now = useNow(30_000)

  const root = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)
  // Distance from the bottom before older messages were prepended, to keep the view in place.
  const keepFromBottom = useRef<number | null>(null)
  const olderLoading = useRef(false)
  const onScreen = useRef(false)
  const readTimer = useRef<number | undefined>(undefined)

  // ---------- reading ----------

  const markReadSoon = useCallback(() => {
    if (DEMO) return
    window.clearTimeout(readTimer.current)
    readTimer.current = window.setTimeout(() => {
      if (document.visibilityState !== 'visible' || !onScreen.current) return
      chatApi.markRead(chatKey).catch(() => {})
    }, READ_DELAY_MS)
  }, [chatKey])

  useEffect(() => {
    const el = root.current
    if (!el) return
    const observer = new IntersectionObserver(([entry]) => {
      onScreen.current = entry?.isIntersecting ?? false
      if (onScreen.current) markReadSoon()
    })
    observer.observe(el)
    const onVisible = () => document.visibilityState === 'visible' && markReadSoon()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      observer.disconnect()
      document.removeEventListener('visibilitychange', onVisible)
      window.clearTimeout(readTimer.current)
    }
  }, [markReadSoon])

  // ---------- loading ----------

  useEffect(() => {
    let cancelled = false
    setMessages([])
    setNextBefore(null)
    setLoadError(null)
    setActionError(null)
    setEditingId(null)
    setLoading(true)
    stickToBottom.current = true
    if (DEMO) {
      setLoading(false)
      return
    }
    chatApi.messages(chatKey).then(
      (page) => {
        if (cancelled) return
        setMessages([...page.messages].sort(byTime))
        setNextBefore(page.nextBefore)
        setLoading(false)
        markReadSoon()
      },
      (error: unknown) => {
        if (cancelled) return
        setLoadError(error)
        setLoading(false)
      },
    )
    return () => {
      cancelled = true
    }
  }, [chatKey, markReadSoon])

  /** After a dropped connection: pull the newest page again and merge what was missed. */
  const refreshLatest = useCallback(async () => {
    try {
      const page = await chatApi.messages(chatKey)
      setMessages((current) => upsert(current, page.messages))
      markReadSoon()
    } catch {
      // The next reconnect or action will show the problem.
    }
  }, [chatKey, markReadSoon])

  async function loadOlder() {
    if (!nextBefore || olderLoading.current) return
    olderLoading.current = true
    setOlderBusy(true)
    try {
      const page = await chatApi.messages(chatKey, nextBefore)
      const el = list.current
      if (el) keepFromBottom.current = el.scrollHeight - el.scrollTop
      setMessages((current) => upsert(current, page.messages))
      setNextBefore(page.nextBefore)
    } catch (error) {
      setActionError(error)
    } finally {
      olderLoading.current = false
      setOlderBusy(false)
    }
  }

  // Keep the reader's place: at the bottom for new messages, in place when history grows above.
  useLayoutEffect(() => {
    const el = list.current
    if (!el) return
    if (keepFromBottom.current !== null) {
      el.scrollTop = el.scrollHeight - keepFromBottom.current
      keepFromBottom.current = null
    } else if (stickToBottom.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [messages])

  function onScroll() {
    const el = list.current
    if (!el) return
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX
    if (el.scrollTop < NEAR_TOP_PX) void loadOlder()
  }

  // ---------- live ----------

  const connected = useLive(
    (event) => {
      if (event.type !== 'message.created' && event.type !== 'message.updated' && event.type !== 'message.deleted') return
      if (event.message.chatKey !== chatKey) return
      const created = event.type === 'message.created'
      setMessages((current) => upsert(current, [event.message], created))
      if (created && event.message.authorId !== me.id) markReadSoon()
    },
    { onReconnect: () => void refreshLatest() },
  )

  // The socket needs a moment on first open; only a lasting drop is worth a note.
  const [offline, setOffline] = useState(false)
  useEffect(() => {
    if (connected) {
      setOffline(false)
      return
    }
    const timer = window.setTimeout(() => setOffline(true), 4000)
    return () => window.clearTimeout(timer)
  }, [connected])

  // ---------- own messages ----------

  async function send(body: string) {
    const message = await chatApi.post(chatKey, { body })
    stickToBottom.current = true
    setMessages((current) => upsert(current, [message]))
  }

  async function saveEdit(id: string, body: string) {
    const message = await chatApi.edit(id, { body })
    setMessages((current) => upsert(current, [message], false))
    setEditingId(null)
  }

  async function remove(message: MessageDto) {
    if (!window.confirm('Удалить сообщение? Отменить удаление будет нельзя.')) return
    setActionError(null)
    try {
      await chatApi.remove(message.id)
      setMessages((current) => upsert(current, [{ ...message, deleted: true, body: '', mentions: [] }], false))
    } catch (error) {
      setActionError(error)
    }
  }

  const canChange = (message: MessageDto) =>
    !readOnly && !message.deleted && message.authorId === me.id && now - Date.parse(message.createdAt) < MESSAGE_EDIT_WINDOW_MS

  // ---------- render ----------

  const author = (id: string): UserDto => people.get(id) ?? { id, ...UNKNOWN }
  const nowDate = new Date(now)

  return (
    <div className="chat" ref={root}>
      <div className="chat-list" ref={list} onScroll={onScroll} aria-busy={loading} role="log" aria-live="polite">
        {nextBefore && (
          <button type="button" className="chat-older" disabled={olderBusy} onClick={() => void loadOlder()}>
            {olderBusy ? 'Загрузка…' : 'Показать более ранние'}
          </button>
        )}
        {loading && <p className="chat-empty">Загрузка…</p>}
        {DEMO && <p className="chat-empty">Чат работает в рабочей версии с сервером.</p>}
        {loadError != null && <ErrorNote error={loadError} />}
        {!loading && !loadError && !DEMO && messages.length === 0 && (
          <p className="chat-empty">{readOnly ? 'В этом чате не писали.' : 'Сообщений пока нет — напишите первым.'}</p>
        )}
        {messages.map((message, index) => {
          const previous = messages[index - 1]
          const newDay = !previous || dayKey(previous.createdAt) !== dayKey(message.createdAt)
          const compact =
            !newDay &&
            previous !== undefined &&
            previous.authorId === message.authorId &&
            Date.parse(message.createdAt) - Date.parse(previous.createdAt) < GROUP_GAP_MS
          const user = author(message.authorId)
          const mine = message.authorId === me.id
          const classes = ['chat-msg']
          if (compact) classes.push('is-compact')
          if (mine) classes.push('is-mine')
          if (!message.deleted && message.mentions.includes(me.id)) classes.push('mentions-me')
          return (
            <div key={message.id} className="chat-row">
              {newDay && (
                <div className="chat-day">
                  <span>{formatDayLabel(message.createdAt, nowDate)}</span>
                </div>
              )}
              <article className={classes.join(' ')}>
                {compact ? (
                  <time className="chat-msg-side" dateTime={message.createdAt} title={formatFull(message.createdAt)}>
                    {formatTime(message.createdAt)}
                  </time>
                ) : (
                  <span className="avatar chat-avatar" aria-hidden="true">
                    {initials(user)}
                  </span>
                )}
                <div className="chat-msg-main">
                  {!compact && (
                    <header className="chat-msg-head">
                      <span className="chat-msg-name">{mine ? 'Вы' : fullName(user)}</span>
                      <time className="chat-msg-time" dateTime={message.createdAt} title={formatFull(message.createdAt)}>
                        {formatTime(message.createdAt)}
                      </time>
                    </header>
                  )}
                  {message.deleted ? (
                    <p className="chat-msg-body chat-deleted">Сообщение удалено</p>
                  ) : editingId === message.id ? (
                    <Composer
                      people={mentionable}
                      initial={message.body}
                      submitLabel="Сохранить"
                      autoFocus
                      onSubmit={(body) => saveEdit(message.id, body)}
                      onCancel={() => setEditingId(null)}
                    />
                  ) : (
                    <p className="chat-msg-body">
                      {renderBody(message, byLogin, me.id)}
                      {message.editedAt && (
                        <span className="chat-edited" title={`Изменено ${formatFull(message.editedAt)}`}>
                          {' '}
                          изменено
                        </span>
                      )}
                    </p>
                  )}
                </div>
                {canChange(message) && editingId !== message.id && (
                  <div className="chat-msg-actions">
                    <button
                      type="button"
                      className="chat-action"
                      onClick={() => {
                        setActionError(null)
                        setEditingId(message.id)
                      }}
                    >
                      Изменить
                    </button>
                    <button type="button" className="chat-action chat-action-danger" onClick={() => void remove(message)}>
                      Удалить
                    </button>
                  </div>
                )}
              </article>
            </div>
          )
        })}
      </div>
      {actionError != null && (
        <div className="chat-footer-note">
          <ErrorNote error={actionError} />
        </div>
      )}
      {!DEMO && !loading && offline && <p className="chat-offline">Нет связи с сервером — новые сообщения появятся после переподключения.</p>}
      {readOnly ? (
        <p className="chat-readonly">Задача завершена — чат только для чтения.</p>
      ) : (
        !DEMO && <Composer people={mentionable} placeholder="Сообщение" submitLabel="Отправить" onSubmit={send} />
      )}
    </div>
  )
}
