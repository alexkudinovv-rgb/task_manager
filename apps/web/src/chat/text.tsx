import type { ReactNode } from 'react'
import type { MessageDto, UserDto } from '@car-city/shared/model'
import { fullName } from '../workspace'

const ZONE = 'Europe/Moscow'

// Same rule as the server (apps/server/src/modules/chats/mentions.ts), plus links.
const TOKENS = /(https?:\/\/[^\s<>"]+[^\s<>".,:;!?)\]'])|(?<![\p{L}\p{N}_.@-])@([a-z][a-z0-9._-]{2,31})/giu

/** Message text with links and highlighted @mentions (only those the server resolved). */
export function renderBody(message: MessageDto, byLogin: Map<string, UserDto>, meId: string): ReactNode[] {
  const parts: ReactNode[] = []
  let last = 0
  for (const match of message.body.matchAll(TOKENS)) {
    const index = match.index ?? 0
    if (index > last) parts.push(message.body.slice(last, index))
    const [token, url, login] = match
    if (url) {
      parts.push(
        <a key={index} href={url} target="_blank" rel="noopener noreferrer" className="chat-link">
          {url}
        </a>,
      )
    } else {
      const lower = login!.toLowerCase()
      const user = byLogin.get(lower) ?? byLogin.get(lower.replace(/[._-]+$/, ''))
      if (user && message.mentions.includes(user.id)) {
        // Keep trailing punctuation outside the highlight.
        const shown = token.slice(0, user.login.length + 1)
        parts.push(
          <span key={index} className={`chat-mention${user.id === meId ? ' is-me' : ''}`} title={fullName(user)}>
            {shown}
          </span>,
        )
        if (token.length > shown.length) parts.push(token.slice(shown.length))
      } else {
        parts.push(token)
      }
    }
    last = index + token.length
  }
  if (last < message.body.length) parts.push(message.body.slice(last))
  return parts
}

/** The `@query` being typed right before the caret, if any. */
export function mentionQueryAt(text: string, caret: number): { start: number; query: string } | null {
  const match = /(?:^|[\s(«"])@([\p{L}\p{N}._-]{0,32})$/u.exec(text.slice(0, caret))
  if (!match) return null
  return { start: caret - match[1]!.length - 1, query: match[1]! }
}

/** Up to `limit` people for an `@query`, matched by login, first or last name. */
export function suggestPeople(query: string, people: UserDto[], limit = 6): UserDto[] {
  const q = query.toLowerCase()
  const rank = (user: UserDto): number => {
    if (!q) return 1
    if (user.login.startsWith(q)) return 0
    if (user.firstName.toLowerCase().startsWith(q) || user.lastName.toLowerCase().startsWith(q)) return 1
    if (fullName(user).toLowerCase().includes(q) || user.login.includes(q)) return 2
    return -1
  }
  return people
    .map((user) => ({ user, rank: rank(user) }))
    .filter((item) => item.rank >= 0)
    .sort((a, b) => a.rank - b.rank || fullName(a.user).localeCompare(fullName(b.user), 'ru'))
    .slice(0, limit)
    .map((item) => item.user)
}

/** YYYY-MM-DD in Moscow time, to group messages by day. */
export function dayKey(iso: string | Date): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: ZONE })
}

export function formatDayLabel(iso: string, now: Date): string {
  const key = dayKey(iso)
  if (key === dayKey(now)) return 'Сегодня'
  if (key === dayKey(new Date(now.getTime() - 86_400_000))) return 'Вчера'
  const sameYear = key.slice(0, 4) === dayKey(now).slice(0, 4)
  return new Date(iso).toLocaleDateString('ru-RU', {
    timeZone: ZONE,
    day: 'numeric',
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ru-RU', { timeZone: ZONE, hour: '2-digit', minute: '2-digit' })
}

export function formatFull(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    timeZone: ZONE,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
