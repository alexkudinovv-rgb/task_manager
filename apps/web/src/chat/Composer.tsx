import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { UserDto } from '@car-city/shared/model'
import { FormError } from '../api/errors'
import { ErrorNote } from '../components/ui'
import { fullName, initials } from '../workspace'
import { mentionQueryAt, suggestPeople } from './text'

const MAX_LENGTH = 4000
const MAX_HEIGHT = 160

interface Props {
  /** People offered after `@`. */
  people: UserDto[]
  initial?: string
  placeholder?: string
  submitLabel: string
  /** Resolves when sent; on a rejection the text stays and the error is shown. */
  onSubmit: (body: string) => Promise<void>
  /** Inline editing: Esc and the extra button cancel. */
  onCancel?: () => void
  autoFocus?: boolean
}

/** Enter sends, Shift+Enter starts a new line; `@` opens the people list. */
export function Composer({ people, initial = '', placeholder, submitLabel, onSubmit, onCancel, autoFocus }: Props) {
  const [text, setText] = useState(initial)
  const [caret, setCaret] = useState(initial.length)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [active, setActive] = useState(0)
  const [dismissedAt, setDismissedAt] = useState<number | null>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const pendingCaret = useRef<number | null>(null)
  const listId = useId()

  const mention = mentionQueryAt(text, caret)
  const options = mention && mention.start !== dismissedAt ? suggestPeople(mention.query, people) : []
  const open = options.length > 0
  const current = Math.min(active, options.length - 1)

  // Grow with the text up to a limit, then scroll.
  useLayoutEffect(() => {
    const el = input.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`
    if (pendingCaret.current !== null) {
      el.setSelectionRange(pendingCaret.current, pendingCaret.current)
      pendingCaret.current = null
    }
  }, [text])

  useLayoutEffect(() => {
    if (!autoFocus) return
    const el = input.current
    el?.focus()
    el?.setSelectionRange(el.value.length, el.value.length)
  }, [autoFocus])

  function change(value: string, position: number) {
    setText(value)
    setCaret(position)
    setActive(0)
    if (error) setError(null)
  }

  function pick(user: UserDto) {
    if (!mention) return
    const insert = `@${user.login} `
    const next = text.slice(0, mention.start) + insert + text.slice(caret)
    const position = mention.start + insert.length
    pendingCaret.current = position
    change(next, position)
    input.current?.focus()
  }

  async function submit() {
    const body = text.trim()
    if (!body || busy) return
    setBusy(true)
    setError(null)
    try {
      if (body.length > MAX_LENGTH) throw new FormError(`Слишком длинное сообщение: не больше ${MAX_LENGTH} символов.`)
      await onSubmit(body)
      if (!onCancel) change('', 0)
    } catch (caught) {
      setError(caught)
    } finally {
      setBusy(false)
      input.current?.focus()
    }
  }

  function keyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.nativeEvent.isComposing) return
    if (open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const step = e.key === 'ArrowDown' ? 1 : -1
        setActive((current + step + options.length) % options.length)
        return
      }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        e.preventDefault()
        pick(options[current]!)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setDismissedAt(mention!.start)
        return
      }
    }
    if (e.key === 'Escape' && onCancel) {
      e.preventDefault()
      onCancel()
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void submit()
    }
  }

  const syncCaret = () => setCaret(input.current?.selectionStart ?? text.length)

  return (
    <form
      className={`chat-composer${onCancel ? ' is-inline' : ''}`}
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      {open && (
        <ul className="chat-suggest" id={listId} role="listbox" aria-label="Упомянуть">
          {options.map((user, index) => (
            <li key={user.id} role="option" aria-selected={index === current}>
              <button
                type="button"
                className={index === current ? 'is-active' : undefined}
                // Keep focus in the textarea.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(user)}
              >
                <span className="avatar avatar-sm" aria-hidden="true">
                  {initials(user)}
                </span>
                <span className="chat-suggest-name">{fullName(user)}</span>
                <span className="chat-suggest-login">@{user.login}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="chat-composer-row">
        <textarea
          ref={input}
          className="chat-input"
          rows={1}
          value={text}
          placeholder={placeholder}
          aria-label={placeholder ?? submitLabel}
          aria-autocomplete="list"
          aria-controls={open ? listId : undefined}
          aria-expanded={open}
          readOnly={busy}
          onChange={(e) => change(e.target.value, e.target.selectionStart)}
          onKeyDown={keyDown}
          onSelect={syncCaret}
          onClick={syncCaret}
        />
        {onCancel && (
          <button type="button" className="chat-action" onClick={onCancel}>
            Отмена
          </button>
        )}
        <button type="submit" className="chat-send" disabled={busy || !text.trim()} aria-label={submitLabel} title={submitLabel}>
          {onCancel ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 19V5M5.5 11.5L12 5l6.5 6.5" />
            </svg>
          )}
        </button>
      </div>
      {!onCancel && <p className="chat-hint">Enter — отправить, Shift+Enter — новая строка, @ — упомянуть</p>}
      <ErrorNote error={error} />
    </form>
  )
}
