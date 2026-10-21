import { useEffect, useRef, useState } from 'react'
import type { WsEvent } from '@car-city/shared/model'
import { DEMO } from '../api'

type Listener = (event: WsEvent) => void
type StatusListener = (connected: boolean, reconnected: boolean) => void

const BACKOFF_MIN_MS = 1000
const BACKOFF_MAX_MS = 30_000
// Lets a component remount (StrictMode, route change) without dropping the socket.
const IDLE_CLOSE_MS = 3000

/**
 * One WebSocket to /api/ws for the whole tab, opened while anyone listens. Reconnects with
 * exponential backoff (and right away when the browser comes back online or the tab is shown).
 * Events missed while offline are not replayed: listeners refetch on `reconnected`.
 */
class LiveConnection {
  private socket: WebSocket | null = null
  private readonly listeners = new Set<Listener>()
  private readonly statusListeners = new Set<StatusListener>()
  private retryTimer: number | undefined
  private idleTimer: number | undefined
  private attempt = 0
  private everOpened = false
  connected = false

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    this.wake()
    return () => {
      this.listeners.delete(listener)
      this.sleepIfIdle()
    }
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener)
    return () => {
      this.statusListeners.delete(listener)
    }
  }

  private wake(): void {
    window.clearTimeout(this.idleTimer)
    if (!this.socket && this.retryTimer === undefined) this.open()
  }

  private sleepIfIdle(): void {
    if (this.listeners.size > 0) return
    window.clearTimeout(this.idleTimer)
    this.idleTimer = window.setTimeout(() => {
      if (this.listeners.size > 0) return
      window.clearTimeout(this.retryTimer)
      this.retryTimer = undefined
      const socket = this.socket
      this.socket = null
      socket?.close()
      this.setConnected(false, false)
    }, IDLE_CLOSE_MS)
  }

  private open(): void {
    if (DEMO || typeof WebSocket === 'undefined') return
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/ws`
    const socket = new WebSocket(url)
    this.socket = socket
    socket.onopen = () => {
      const reconnected = this.everOpened
      this.everOpened = true
      this.attempt = 0
      this.setConnected(true, reconnected)
    }
    socket.onmessage = (message) => {
      let event: WsEvent
      try {
        event = JSON.parse(String(message.data)) as WsEvent
      } catch {
        return
      }
      for (const listener of [...this.listeners]) listener(event)
    }
    socket.onclose = () => {
      if (this.socket !== socket) return
      this.socket = null
      this.setConnected(false, false)
      if (this.listeners.size > 0) this.scheduleRetry()
    }
  }

  private scheduleRetry(): void {
    if (this.retryTimer !== undefined) return
    const base = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** this.attempt)
    this.attempt += 1
    this.retryTimer = window.setTimeout(() => this.retryNow(), base / 2 + Math.random() * (base / 2))
  }

  /** Skips the remaining backoff, e.g. when the network or the tab comes back. */
  retryNow(): void {
    window.clearTimeout(this.retryTimer)
    this.retryTimer = undefined
    if (!this.socket && this.listeners.size > 0) this.open()
  }

  private setConnected(connected: boolean, reconnected: boolean): void {
    if (this.connected === connected) return
    this.connected = connected
    for (const listener of [...this.statusListeners]) listener(connected, reconnected)
  }
}

const live = new LiveConnection()

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => live.retryNow())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') live.retryNow()
  })
}

/** Subscribes outside React; returns the unsubscribe function. */
export function subscribeLive(listener: Listener): () => void {
  return live.subscribe(listener)
}

export interface LiveOptions {
  /** Called after the socket comes back from a drop: refetch what may have been missed. */
  onReconnect?: () => void
}

/**
 * Live server events for a component. `onEvent` may change every render; the latest one is used.
 * Returns whether the live channel is connected right now.
 */
export function useLive(onEvent: Listener, options: LiveOptions = {}): boolean {
  const handler = useRef(onEvent)
  const reconnect = useRef(options.onReconnect)
  handler.current = onEvent
  reconnect.current = options.onReconnect
  const [connected, setConnected] = useState(live.connected)

  useEffect(() => {
    const unsubscribe = live.subscribe((event) => handler.current(event))
    const unwatch = live.onStatus((isConnected, reconnected) => {
      setConnected(isConnected)
      if (reconnected) reconnect.current?.()
    })
    setConnected(live.connected)
    return () => {
      unwatch()
      unsubscribe()
    }
  }, [])

  return connected
}
