import type { Actor, WsEvent } from '@car-city/shared/model'
import type { WebSocket } from 'ws'

export interface LiveClient extends Actor {
  /** Checked on every heartbeat; false closes the socket (session ended or user disabled). */
  stillValid?: () => Promise<boolean>
}

interface Entry {
  client: LiveClient
  alive: boolean
}

const HEARTBEAT_MS = 30_000
/** Close code for a socket whose session is gone; the client may stop reconnecting. */
export const SESSION_ENDED_CODE = 4401

/**
 * In-process registry of open /api/ws sockets, keyed by user. A single server process holds every
 * connection, so publishing is a direct send (several processes would need a broker in between).
 *
 * API for other modules:
 *   liveHub.publish(userIds, event)  sends a WsEvent to every open tab of these users
 *   liveHub.broadcast(event)         sends it to everyone connected
 *   liveHub.connected()              who is online (id + role), to filter by visibility before publishing
 * Visibility-aware wrappers live in ./service.ts: publishToChat(db, chatKey, event) and
 * publishTaskChanged(db, taskId, alsoTo) for { type: 'task.changed', taskId }.
 */
export class LiveHub {
  private readonly entries = new Map<WebSocket, Entry>()
  private readonly byUser = new Map<string, Set<WebSocket>>()
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly heartbeatMs = HEARTBEAT_MS) {}

  add(socket: WebSocket, client: LiveClient): void {
    this.entries.set(socket, { client, alive: true })
    const sockets = this.byUser.get(client.id) ?? new Set()
    sockets.add(socket)
    this.byUser.set(client.id, sockets)

    socket.on('pong', () => {
      const entry = this.entries.get(socket)
      if (entry) entry.alive = true
    })
    socket.on('close', () => this.remove(socket))
    socket.on('error', () => socket.terminate())
    this.startHeartbeat()
  }

  publish(userIds: Iterable<string>, event: WsEvent): void {
    const frame = JSON.stringify(event)
    for (const userId of new Set(userIds)) {
      for (const socket of this.byUser.get(userId) ?? []) send(socket, frame)
    }
  }

  broadcast(event: WsEvent): void {
    const frame = JSON.stringify(event)
    for (const socket of this.entries.keys()) send(socket, frame)
  }

  /** Connected users, one entry per user. */
  connected(): Actor[] {
    const users = new Map<string, Actor>()
    for (const { client } of this.entries.values()) users.set(client.id, { id: client.id, role: client.role })
    return [...users.values()]
  }

  get size(): number {
    return this.entries.size
  }

  private remove(socket: WebSocket): void {
    const entry = this.entries.get(socket)
    if (!entry) return
    this.entries.delete(socket)
    const sockets = this.byUser.get(entry.client.id)
    sockets?.delete(socket)
    if (sockets?.size === 0) this.byUser.delete(entry.client.id)
    if (this.entries.size === 0) this.stopHeartbeat()
  }

  private startHeartbeat(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.beat(), this.heartbeatMs)
    this.timer.unref()
  }

  private stopHeartbeat(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** Drops sockets that missed the last ping, pings the rest and re-checks their sessions. */
  private async beat(): Promise<void> {
    const checks: Promise<void>[] = []
    for (const [socket, entry] of this.entries) {
      if (!entry.alive) {
        socket.terminate()
        continue
      }
      entry.alive = false
      socket.ping()
      const { stillValid } = entry.client
      if (stillValid) {
        checks.push(
          stillValid().then(
            (valid) => {
              if (!valid) socket.close(SESSION_ENDED_CODE, 'session ended')
            },
            () => {}, // a database hiccup is not a reason to drop the user
          ),
        )
      }
    }
    await Promise.all(checks)
  }
}

function send(socket: WebSocket, frame: string): void {
  // 1 = OPEN; sockets still connecting or already closing are skipped.
  if (socket.readyState === 1) socket.send(frame)
}

export const liveHub = new LiveHub()
