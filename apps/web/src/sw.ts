/// <reference lib="webworker" />
// Service worker: app shell precache, offline workspace, web push. Built by vite-plugin-pwa (injectManifest).
import { clientsClaim } from 'workbox-core'
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute, type PrecacheEntry } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { NetworkFirst } from 'workbox-strategies'
import { API_CACHE, base64UrlToBytes, CACHED_AT_HEADER, ME_PATH, WORKSPACE_PATH, type PushPayload } from './pwa/shared'

declare let self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (PrecacheEntry | string)[] }

const SCOPE = self.registration.scope // ends with '/', e.g. https://host/ or https://host/task_manager/
const DEFAULT_TITLE = 'Car City · Задачи'

// --- App shell ---

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()
// First install takes over the open page right away; later updates wait for SKIP_WAITING (UpdatePrompt).
clientsClaim()

self.addEventListener('message', (event) => {
  if ((event.data as { type?: string } | null)?.type === 'SKIP_WAITING') void self.skipWaiting()
})

try {
  // Any in-app address (/, /invite/<token>) opens the cached shell; /api/* always goes to the network.
  registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html'), { denylist: [/^\/api\//] }))
} catch {
  // Dev build without a precached index.html.
}

// --- API: only the workspace and "who am I" are cached, for offline reading ---

const OFFLINE_READABLE = new Set([WORKSPACE_PATH, ME_PATH])

registerRoute(
  ({ url, request, sameOrigin }) =>
    sameOrigin && request.method === 'GET' && url.search === '' && OFFLINE_READABLE.has(url.pathname),
  new NetworkFirst({
    cacheName: API_CACHE,
    networkTimeoutSeconds: 4,
    plugins: [
      {
        // Only good answers, stamped with the time they came from the server (OfflineBanner shows it).
        cacheWillUpdate: async ({ response }) => {
          if (response.status !== 200) return null
          const headers = new Headers(response.headers)
          headers.set(CACHED_AT_HEADER, new Date().toISOString())
          return new Response(await response.blob(), { status: 200, statusText: response.statusText, headers })
        },
        // Session gone: someone else's tasks must not stay readable offline.
        fetchDidSucceed: async ({ response }) => {
          if (response.status === 401) await caches.delete(API_CACHE)
          return response
        },
      },
    ],
  }),
  'GET',
)

// Login/logout change who the cached data belongs to.
const SESSION_CHANGE = /^\/api\/(auth\/(login|verify|logout|logout-all)|invites\/[^/]+\/accept)$/
const SESSION_START = /^\/api\/(auth\/verify|invites\/[^/]+\/accept)$/
const LOGOUT = /^\/api\/auth\/logout(-all)?$/

registerRoute(
  ({ url, sameOrigin }) => sameOrigin && SESSION_CHANGE.test(url.pathname),
  async ({ request, url }) => {
    const logout = LOGOUT.test(url.pathname)
    // While the session still exists: this device stops getting the user's pushes.
    if (logout) await withTimeout(forgetSubscriptionOnServer(), 3000)
    const response = await fetch(request)
    if (response.ok || logout) await caches.delete(API_CACHE)
    // A new session on a device that has push on: hand the subscription to the new user.
    if (response.ok && SESSION_START.test(url.pathname)) void resyncSubscription()
    return response
  },
  'POST',
)
// Everything else (other /api calls, POST/PUT/PATCH/DELETE, /api/attachments/*, /api/ws) is not routed: network only.

// --- Web push ---

self.addEventListener('push', (event) => {
  const payload = readPayload(event.data)
  const options: NotificationOptions & { renotify?: boolean } = {
    body: payload.body,
    icon: new URL(`${import.meta.env.VITE_ICON_DIR ?? 'icons'}/icon-192.png`, SCOPE).href,
    badge: new URL('icons/badge-96.png', SCOPE).href,
    lang: 'ru',
    data: { url: appUrl(payload.url) },
  }
  if (payload.tag) {
    options.tag = payload.tag
    // Same tag replaces the old notification but still rings.
    options.renotify = true
  }
  event.waitUntil(self.registration.showNotification(payload.title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data as { url?: string } | null)?.url ?? SCOPE
  event.waitUntil(openApp(url))
})

// The browser rotated the subscription (expiry, key change): tell the server about the new one.
self.addEventListener('pushsubscriptionchange', (event) => {
  const e = event as ExtendableEvent & { oldSubscription?: PushSubscription | null; newSubscription?: PushSubscription | null }
  e.waitUntil(replaceSubscription(e.oldSubscription ?? null, e.newSubscription ?? null))
})

function readPayload(data: PushMessageData | null): PushPayload {
  if (!data) return { title: DEFAULT_TITLE, body: '' }
  try {
    const json = data.json() as Partial<PushPayload>
    return {
      title: typeof json.title === 'string' && json.title ? json.title : DEFAULT_TITLE,
      body: typeof json.body === 'string' ? json.body : '',
      url: typeof json.url === 'string' ? json.url : undefined,
      tag: typeof json.tag === 'string' && json.tag ? json.tag : undefined,
    }
  } catch {
    return { title: DEFAULT_TITLE, body: data.text() }
  }
}

/** '/x' is a path inside the app (under its base); anything off-origin falls back to the home page. */
function appUrl(url: string | undefined): string {
  if (!url) return SCOPE
  try {
    const resolved = new URL(url.startsWith('/') && !url.startsWith('//') ? url.slice(1) : url, SCOPE)
    return resolved.origin === self.location.origin ? resolved.href : SCOPE
  } catch {
    return SCOPE
  }
}

async function openApp(url: string): Promise<void> {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  const client = windows.find((c) => c.url.startsWith(SCOPE))
  if (!client) {
    await self.clients.openWindow(url)
    return
  }
  // Focus first: the click's permission to focus does not survive a long await.
  const focused = await client.focus()
  if (focused.url !== url) {
    try {
      await focused.navigate(url)
    } catch {
      // Uncontrolled window: leave it where it is.
    }
  }
}

const SUBSCRIPTIONS_URL = '/api/push/subscriptions'

function api(method: string, path: string, body?: unknown): Promise<Response> {
  return fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function subscriptionBody(sub: PushSubscription) {
  const json = sub.toJSON()
  return { endpoint: sub.endpoint, keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' } }
}

async function forgetSubscriptionOnServer(): Promise<void> {
  try {
    const sub = await self.registration.pushManager.getSubscription()
    if (sub) await api('DELETE', SUBSCRIPTIONS_URL, { endpoint: sub.endpoint })
  } catch {
    // Offline or already gone: logout must still go through.
  }
}

async function resyncSubscription(): Promise<void> {
  try {
    const sub = await self.registration.pushManager.getSubscription()
    if (sub) await api('POST', SUBSCRIPTIONS_URL, subscriptionBody(sub))
  } catch {
    // PushSettings re-syncs when it is opened.
  }
}

async function replaceSubscription(old: PushSubscription | null, next: PushSubscription | null): Promise<void> {
  try {
    let sub = next
    if (!sub) {
      const response = await api('GET', '/api/push/public-key')
      const publicKey = response.ok ? ((await response.json()) as { publicKey: string | null }).publicKey : null
      if (!publicKey) return
      sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(publicKey) })
    }
    await api('POST', SUBSCRIPTIONS_URL, subscriptionBody(sub))
    if (old && old.endpoint !== sub.endpoint) await api('DELETE', SUBSCRIPTIONS_URL, { endpoint: old.endpoint })
  } catch {
    // Next visit to PushSettings fixes it.
  }
}

function withTimeout(promise: Promise<void>, ms: number): Promise<void> {
  return Promise.race([promise, new Promise<void>((resolve) => setTimeout(resolve, ms))])
}
