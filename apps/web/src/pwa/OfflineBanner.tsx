import { useEffect, useState } from 'react'
import { API_CACHE, CACHED_AT_HEADER, WORKSPACE_PATH } from './shared'
import { useOnline } from './useOnline'
import './pwa.css'

/** When the cached workspace (what the app shows offline) came from the server. */
export async function workspaceCachedAt(): Promise<Date | null> {
  try {
    if (!('caches' in window)) return null
    const response = await caches.match(WORKSPACE_PATH, { cacheName: API_CACHE })
    const stamp = response?.headers.get(CACHED_AT_HEADER) ?? response?.headers.get('date')
    const date = stamp ? new Date(stamp) : null
    return date && !Number.isNaN(date.getTime()) ? date : null
  } catch {
    return null
  }
}

function formatStamp(date: Date, now = new Date()): string {
  const time = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  if (date.toDateString() === now.toDateString()) return time
  return `${date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}, ${time}`
}

/** «Нет сети — показаны данные на HH:MM». Renders nothing while online. */
export function OfflineBanner() {
  const online = useOnline()
  const [cachedAt, setCachedAt] = useState<Date | null>(null)

  useEffect(() => {
    if (online) return
    let ignore = false
    void workspaceCachedAt().then((date) => {
      if (!ignore) setCachedAt(date)
    })
    return () => {
      ignore = true
    }
  }, [online])

  if (online) return null
  return (
    <div className="pwa-offline" role="status">
      <span className="pwa-offline-dot" aria-hidden="true" />
      {cachedAt ? `Нет сети — показаны данные на ${formatStamp(cachedAt)}` : 'Нет сети — показаны последние загруженные данные'}
    </div>
  )
}
