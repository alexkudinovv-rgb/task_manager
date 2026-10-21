// Shared by the service worker (src/sw.ts) and the page.

/** Cache with the last GET /api/workspace and /api/auth/me answers (offline mode). */
export const API_CACHE = 'cc-api'
/** Header the service worker stamps on cached API answers: when they came from the network (ISO). */
export const CACHED_AT_HEADER = 'x-cc-cached-at'
/** The API is mounted at /api on the app's origin regardless of Vite's base (see api/http.ts). */
export const WORKSPACE_PATH = '/api/workspace'
export const ME_PATH = '/api/auth/me'

/**
 * Web push payload (JSON) the server sends and the service worker shows.
 * `url` is a path inside the app ('/' = home), resolved against the app's base; `tag` replaces an
 * earlier notification with the same tag (and still rings).
 */
export interface PushPayload {
  title: string
  body: string
  url?: string
  tag?: string
}

/** VAPID public key (base64url) → bytes for PushManager.subscribe. */
export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = (value + '='.repeat((4 - (value.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

export function bytesToBase64Url(buffer: ArrayBuffer | null): string {
  if (!buffer) return ''
  let raw = ''
  for (const byte of new Uint8Array(buffer)) raw += String.fromCharCode(byte)
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
