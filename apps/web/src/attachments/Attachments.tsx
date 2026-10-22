import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import { ATTACHMENT_MAX_BYTES, type AttachmentDto } from '@car-city/shared/model'
import { errorMessage } from '../api/errors'
import { attachmentApi } from '../api/server'
import './attachments.css'

interface Props {
  taskId: string
  /** Whoever sees the task while it is not done (the server checks again). */
  canUpload: boolean
  /** Uploader, task author or owner, task not done. */
  canDelete: (attachment: AttachmentDto) => boolean
  /** After an upload or delete: refresh what depends on attachmentCount («Нужен документ»). */
  onChanged?: () => void
  /** Display name for the uploader; without it the uploader is not shown. */
  userName?: (userId: string) => string
  /** Bumped when someone else changed the task: the list is refetched in place. */
  revision?: number
}

interface Upload {
  key: number
  name: string
  loaded: number
  total: number
  error: string | null
}

const PREVIEW_IMAGES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const MAX_MB = Math.round(ATTACHMENT_MAX_BYTES / 1024 / 1024)

const dateFormat = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Moscow',
})

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`
  const mb = bytes / 1024 / 1024
  return `${mb < 10 ? mb.toFixed(1).replace('.', ',') : Math.round(mb)} МБ`
}

/** Short type badge: by MIME first, then by extension. */
function kindOf(a: AttachmentDto): { label: string; tone: string } {
  const ext = a.fileName.includes('.') ? a.fileName.split('.').pop()!.toLowerCase() : ''
  if (a.mime === 'application/pdf') return { label: 'PDF', tone: 'pdf' }
  if (a.mime.startsWith('image/')) return { label: 'IMG', tone: 'img' }
  if (['doc', 'docx', 'odt', 'rtf', 'txt'].includes(ext)) return { label: 'DOC', tone: 'doc' }
  if (['xls', 'xlsx', 'ods', 'csv'].includes(ext)) return { label: 'XLS', tone: 'xls' }
  if (['zip', 'rar', '7z', 'gz', 'tar'].includes(ext)) return { label: 'ZIP', tone: 'zip' }
  return { label: ext && ext.length <= 4 ? ext.toUpperCase() : 'FILE', tone: 'file' }
}

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError'

/** Task files: list with previews, upload (button or drag-and-drop) with progress, delete. */
export function Attachments({ taskId, canUpload, canDelete, onChanged, userName, revision = 0 }: Props) {
  const [items, setItems] = useState<AttachmentDto[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [uploads, setUploads] = useState<Upload[]>([])
  const [dragging, setDragging] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const controllers = useRef(new Set<AbortController>())
  const nextKey = useRef(0)
  const dragDepth = useRef(0)

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      setItems(await attachmentApi.list(taskId))
    } catch (error) {
      setLoadError(errorMessage(error))
    }
  }, [taskId])

  useEffect(() => {
    setItems(null)
    setUploads([])
    setActionError(null)
    void load()
  }, [load])

  useEffect(() => {
    if (revision > 0) void load()
  }, [revision, load])

  // Leaving the task cancels uploads still in flight.
  useEffect(() => {
    const active = controllers.current
    return () => {
      for (const controller of active) controller.abort()
      active.clear()
    }
  }, [taskId])

  const patchUpload = (key: number, patch: Partial<Upload>) =>
    setUploads((list) => list.map((u) => (u.key === key ? { ...u, ...patch } : u)))

  async function uploadOne(file: File) {
    const key = nextKey.current++
    const tooBig = file.size > ATTACHMENT_MAX_BYTES
    const empty = file.size === 0
    const error = tooBig ? `Больше ${MAX_MB} МБ — такой файл не загрузить` : empty ? 'Файл пустой' : null
    setUploads((list) => [...list, { key, name: file.name, loaded: 0, total: file.size, error }])
    if (error) return

    const controller = new AbortController()
    controllers.current.add(controller)
    try {
      const created = await attachmentApi.upload(taskId, file, {
        signal: controller.signal,
        onProgress: (loaded, total) => patchUpload(key, { loaded, total }),
      })
      setUploads((list) => list.filter((u) => u.key !== key))
      setItems((list) => [created, ...(list ?? []).filter((a) => a.id !== created.id)])
      onChanged?.()
    } catch (failure) {
      if (isAbort(failure)) setUploads((list) => list.filter((u) => u.key !== key))
      else patchUpload(key, { error: errorMessage(failure) })
    } finally {
      controllers.current.delete(controller)
    }
  }

  async function uploadAll(files: FileList | File[]) {
    setActionError(null)
    // One request per file, one after another: the server takes a single file per upload.
    for (const file of Array.from(files)) await uploadOne(file)
  }

  async function remove(a: AttachmentDto) {
    if (!window.confirm(`Удалить файл «${a.fileName}»?`)) return
    setActionError(null)
    setDeleting(a.id)
    try {
      await attachmentApi.remove(a.id)
      setItems((list) => (list ?? []).filter((x) => x.id !== a.id))
      onChanged?.()
    } catch (error) {
      setActionError(errorMessage(error))
    } finally {
      setDeleting(null)
    }
  }

  const dragProps = canUpload
    ? {
        onDragEnter: (e: DragEvent) => {
          if (!e.dataTransfer.types.includes('Files')) return
          e.preventDefault()
          dragDepth.current += 1
          setDragging(true)
        },
        onDragOver: (e: DragEvent) => {
          if (!e.dataTransfer.types.includes('Files')) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        },
        onDragLeave: () => {
          dragDepth.current = Math.max(0, dragDepth.current - 1)
          if (dragDepth.current === 0) setDragging(false)
        },
        onDrop: (e: DragEvent) => {
          e.preventDefault()
          dragDepth.current = 0
          setDragging(false)
          if (e.dataTransfer.files.length > 0) void uploadAll(e.dataTransfer.files)
        },
      }
    : {}

  return (
    <section className={`panel-section att${dragging ? ' is-dragging' : ''}`} aria-label="Файлы задачи" {...dragProps}>
      <div className="att-head">
        <h3 className="mono-label">Файлы{items && items.length > 0 ? ` · ${items.length}` : ''}</h3>
        {canUpload && (
          <>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => input.current?.click()}>
              Прикрепить
            </button>
            <input
              ref={input}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                const files = e.currentTarget.files
                if (files && files.length > 0) void uploadAll(Array.from(files))
                e.currentTarget.value = ''
              }}
            />
          </>
        )}
      </div>

      {canUpload && (
        <p className="att-drop" aria-hidden="true">
          {dragging ? 'Отпустите, чтобы загрузить' : `Перетащите файлы сюда · до ${MAX_MB} МБ каждый`}
        </p>
      )}

      {uploads.length > 0 && (
        <ul className="att-uploads">
          {uploads.map((u) => {
            const percent = u.total > 0 ? Math.min(100, Math.round((u.loaded / u.total) * 100)) : 0
            return (
              <li key={u.key} className={`att-upload${u.error ? ' is-failed' : ''}`}>
                <div className="att-upload-row">
                  <span className="att-name">{u.name}</span>
                  {u.error ? (
                    <button
                      type="button"
                      className="att-icon-button"
                      aria-label="Скрыть"
                      onClick={() => setUploads((list) => list.filter((x) => x.key !== u.key))}
                    >
                      ✕
                    </button>
                  ) : (
                    <span className="att-meta mono">{percent}%</span>
                  )}
                </div>
                {u.error ? (
                  <p className="att-error" role="alert">
                    {u.error}
                  </p>
                ) : (
                  <progress className="att-progress" max={100} value={percent} aria-label={`Загрузка ${u.name}`} />
                )}
              </li>
            )
          })}
        </ul>
      )}

      {loadError ? (
        <p className="att-error" role="alert">
          {loadError}{' '}
          <button type="button" className="link-button" onClick={() => void load()}>
            Повторить
          </button>
        </p>
      ) : items === null ? (
        <p className="muted">Загружаем файлы…</p>
      ) : items.length === 0 ? (
        uploads.length === 0 && <p className="muted">Файлов пока нет.</p>
      ) : (
        <ul className="att-list">
          {items.map((a) => {
            const kind = kindOf(a)
            const image = PREVIEW_IMAGES.has(a.mime)
            const opens = image || a.mime === 'application/pdf'
            const linkProps = opens
              ? { href: a.url, target: '_blank', rel: 'noopener noreferrer' }
              : { href: a.url, download: a.fileName }
            const uploader = userName?.(a.uploadedBy)
            return (
              <li key={a.id} className="att-item">
                <a className="att-thumb" {...linkProps} aria-label={`Открыть ${a.fileName}`} tabIndex={-1}>
                  {image ? (
                    <img src={a.url} alt="" loading="lazy" decoding="async" />
                  ) : (
                    <span className={`att-badge att-badge-${kind.tone}`}>{kind.label}</span>
                  )}
                </a>
                <div className="att-body">
                  <a className="att-name" {...linkProps} title={a.fileName}>
                    {a.fileName}
                  </a>
                  <span className="att-meta">
                    {formatBytes(a.sizeBytes)}
                    {uploader ? ` · ${uploader}` : ''} · {dateFormat.format(new Date(a.createdAt))}
                  </span>
                </div>
                {canDelete(a) && (
                  <button
                    type="button"
                    className="att-icon-button"
                    aria-label={`Удалить ${a.fileName}`}
                    title="Удалить"
                    disabled={deleting === a.id}
                    onClick={() => void remove(a)}
                  >
                    ✕
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {actionError && (
        <p className="att-error" role="alert">
          {actionError}
        </p>
      )}
    </section>
  )
}
