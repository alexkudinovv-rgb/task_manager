import { and, eq, inArray } from 'drizzle-orm'
import webpush, { type Urgency } from 'web-push'
import type { Config } from '../../config'
import type { Db } from '../../db/client'
import { pushSubscriptions } from '../../db/schema'

/**
 * What the service worker shows (apps/web/src/sw.ts). `url` is a path inside the app ('/' = home),
 * resolved against the app's base; `tag` replaces an earlier notification with the same tag.
 */
export interface PushPayload {
  title: string
  body: string
  url?: string
  tag?: string
}

export interface PushSendOptions {
  /** 'high' wakes the phone right away (default); 'normal' lets it batch, e.g. for digests. */
  urgency?: Urgency
  /** How long the push service keeps an undelivered message. Default 24 h. */
  ttlSeconds?: number
  log?: { warn: (obj: object, msg: string) => void }
}

export interface PushSendResult {
  sent: number
  /** Subscriptions the push service reported gone (404/410), deleted from the database. */
  removed: number
  failed: number
}

const DEFAULT_TTL_SECONDS = 24 * 60 * 60
const SEND_TIMEOUT_MS = 10_000

export function isPushConfigured(config: Config): boolean {
  return Boolean(config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY)
}

let vapidFor: string | null = null

/** Sets the VAPID details once per key set; false when push is not configured. */
export function ensureVapid(config: Config): boolean {
  if (!isPushConfigured(config)) return false
  const key = `${config.VAPID_SUBJECT}\n${config.VAPID_PUBLIC_KEY}\n${config.VAPID_PRIVATE_KEY}`
  if (vapidFor !== key) {
    webpush.setVapidDetails(config.VAPID_SUBJECT, config.VAPID_PUBLIC_KEY!, config.VAPID_PRIVATE_KEY!)
    vapidFor = key
  }
  return true
}

// The server POSTs to whatever endpoint a browser hands it, so only known push services are ever
// contacted (no SSRF via internal hosts, DNS rebinding or wildcard DNS like nip.io).
const PUSH_HOSTS = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com']
const PUSH_HOST_SUFFIXES = ['.push.apple.com', '.notify.windows.com', '.wns.windows.com']

/** https on the default port, host = a known push service (Chrome/Edge-FCM, Firefox, Safari, Windows). */
export function isAllowedEndpoint(endpoint: string): boolean {
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return false
  }
  // url.port is '' for the default port (443 is normalised away).
  if (url.protocol !== 'https:' || url.port !== '' || url.username || url.password) return false
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  return PUSH_HOSTS.includes(host) || PUSH_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))
}

/** Sends to every subscription of the user in parallel; never throws on delivery problems. */
export async function sendPushToUser(
  db: Db,
  config: Config,
  userId: string,
  payload: PushPayload,
  options: PushSendOptions = {},
): Promise<PushSendResult> {
  return sendPushToUsers(db, config, [userId], payload, options)
}

export async function sendPushToUsers(
  db: Db,
  config: Config,
  userIds: readonly string[],
  payload: PushPayload,
  options: PushSendOptions = {},
): Promise<PushSendResult> {
  const result: PushSendResult = { sent: 0, removed: 0, failed: 0 }
  if (userIds.length === 0 || !ensureVapid(config)) return result
  const subs = await db.select().from(pushSubscriptions).where(inArray(pushSubscriptions.userId, [...new Set(userIds)]))
  const body = JSON.stringify(payload)
  const gone: string[] = []

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, body, {
          TTL: options.ttlSeconds ?? DEFAULT_TTL_SECONDS,
          urgency: options.urgency ?? 'high',
          timeout: SEND_TIMEOUT_MS,
        })
        result.sent++
      } catch (error) {
        const status = (error as { statusCode?: unknown }).statusCode
        if (status === 404 || status === 410) {
          gone.push(sub.id)
          return
        }
        result.failed++
        const warn = options.log?.warn.bind(options.log) ?? ((obj: object, msg: string) => console.warn(msg, obj))
        warn({ err: error, statusCode: status, subscriptionId: sub.id, userId: sub.userId }, 'web push failed')
      }
    }),
  )

  if (gone.length > 0) {
    await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, gone))
    result.removed = gone.length
  }
  return result
}

export async function upsertSubscription(
  db: Db,
  userId: string,
  input: { endpoint: string; keys: { p256dh: string; auth: string } },
): Promise<void> {
  const values = { userId, endpoint: input.endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth }
  // The endpoint is the browser's identity: a new login on the same phone takes it over.
  await db
    .insert(pushSubscriptions)
    .values(values)
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId, p256dh: values.p256dh, auth: values.auth } })
}

export async function deleteSubscription(db: Db, userId: string, endpoint: string): Promise<void> {
  await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)))
}
