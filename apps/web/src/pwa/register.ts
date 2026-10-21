/// <reference types="vite-plugin-pwa/client" />
import { registerSW } from 'virtual:pwa-register'

// Registration lives in bundled code: the server's CSP (script-src 'self') forbids inline scripts.

const UPDATE_CHECK_MS = 60 * 60 * 1000

let needRefresh = false
let updateSW: ((reloadPage?: boolean) => Promise<void>) | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

/** Call once from main.tsx. In `npm run dev` this is a no-op unless PWA_DEV=1. */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return
  updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      needRefresh = true
      emit()
    },
    onRegisteredSW(_url, registration) {
      // Installed apps stay open for days: look for a new version every hour.
      if (registration) setInterval(() => void registration.update().catch(() => {}), UPDATE_CHECK_MS)
    },
    onRegisterError(error) {
      console.warn('Service worker registration failed', error)
    },
  })
}

export const updateState = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  needRefresh: (): boolean => needRefresh,
}

/** Activates the waiting service worker; the page reloads when it takes over. */
export function applyUpdate(): void {
  void updateSW?.(true)
}

export function dismissUpdate(): void {
  needRefresh = false
  emit()
}
