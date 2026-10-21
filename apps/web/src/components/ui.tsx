import { useEffect, useRef, useState, type ReactNode } from 'react'
import { apiErrorBody, errorMessage, passwordProblems } from '../api/errors'
import type { Lookup } from '../workspace'

/** Runs one request at a time and keeps its error for an inline note. */
export function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)

  async function run(work: () => Promise<void>): Promise<boolean> {
    setBusy(true)
    setError(null)
    try {
      await work()
      return true
    } catch (caught) {
      setError(caught)
      return false
    } finally {
      setBusy(false)
    }
  }

  return { busy, error, run, clear: () => setError(null) }
}

interface ErrorNoteProps {
  error: unknown
  /** With both set, a hot_limit error offers to open the conflicting task. */
  lookup?: Lookup
  onOpenTask?: (id: string) => void
}

export function ErrorNote({ error, lookup, onOpenTask }: ErrorNoteProps) {
  if (!error) return null
  const problems = passwordProblems(error)
  const body = apiErrorBody(error)
  const conflictId = body?.error === 'hot_limit' ? body.conflictingTaskId : undefined
  const conflict = conflictId ? lookup?.tasks.get(conflictId) : undefined

  return (
    <div className="error-note" role="alert">
      <p>{errorMessage(error)}</p>
      {problems.length > 0 && (
        <ul>
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
      {conflict && onOpenTask && (
        <button type="button" className="link-button" onClick={() => onOpenTask(conflict.id)}>
          Открыть «{conflict.title}»
        </button>
      )}
    </div>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  )
}

export function CopyButton({ text, label = 'Скопировать' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API needs https or localhost; fall back to a manual copy.
      window.prompt('Скопируйте вручную:', text)
    }
  }

  return (
    <button type="button" className="btn btn-secondary btn-sm" onClick={copy}>
      {copied ? 'Скопировано' : label}
    </button>
  )
}

/** Right-hand side sheet on a native modal dialog; closes on Esc, ✕ or a backdrop click. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    dialog.current?.showModal()
  }, [])

  return (
    <dialog
      ref={dialog}
      className="panel"
      aria-label={title}
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && dialog.current?.close()}
    >
      <div className="panel-body">
        <div className="panel-head">
          <h2 className="panel-title">{title}</h2>
          <button type="button" className="panel-close" aria-label="Закрыть" onClick={() => dialog.current?.close()}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </dialog>
  )
}

/** "21 октября, 18:00" in Moscow time. */
export function formatMoment(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  })
}
