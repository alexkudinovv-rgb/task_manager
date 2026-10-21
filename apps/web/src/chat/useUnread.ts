import { useCallback, useEffect, useRef, useState } from 'react'
import type { UnreadDto } from '@car-city/shared/model'
import { DEMO } from '../api'
import { chatApi } from '../api/server'
import { useLive } from './useLive'

const EMPTY: UnreadDto = { general: 0, tasks: {} }
// Several events often arrive together (a post and its read marker); one refetch covers them.
const DEBOUNCE_MS = 300

/** Sum of every unread counter, e.g. for a tab title or an app badge. */
export function unreadTotal(unread: UnreadDto): number {
  return unread.general + Object.values(unread.tasks).reduce((sum, n) => sum + n, 0)
}

/**
 * Unread counters for the sidebar: the general chat and each visible task chat with something new.
 * Refetched on live chat events, on reconnect and when the tab becomes visible again.
 */
export function useUnread(): UnreadDto {
  const [unread, setUnread] = useState<UnreadDto>(EMPTY)
  const timer = useRef<number | undefined>(undefined)

  const load = useCallback(async () => {
    if (DEMO) return
    try {
      setUnread(await chatApi.unread())
    } catch {
      // Keep the last known counters; the next event or reconnect tries again.
    }
  }, [])

  const schedule = useCallback(() => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void load(), DEBOUNCE_MS)
  }, [load])

  useEffect(() => {
    void load()
    const onVisible = () => document.visibilityState === 'visible' && schedule()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.clearTimeout(timer.current)
    }
  }, [load, schedule])

  useLive(
    (event) => {
      // task.changed may change which task chats the viewer sees.
      if (event.type !== 'message.updated') schedule()
    },
    { onReconnect: schedule },
  )

  return unread
}
