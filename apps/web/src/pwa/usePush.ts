import type { PushSubscriptionInput } from '@car-city/shared/model'
import { useCallback, useEffect, useRef, useState } from 'react'
import { errorMessage } from '../api/errors'
import { ApiRequestError } from '../api/http'
import { pushApi } from '../api/server'
import { base64UrlToBytes, bytesToBase64Url } from './shared'

export type PushStatus =
  | 'checking'
  /** GitHub Pages demo: no server. */
  | 'demo'
  /** iPhone/iPad in a browser tab: push works only from the home-screen app (iOS 16.4+). */
  | 'ios-install'
  | 'unsupported'
  /** The server has no VAPID keys. */
  | 'unconfigured'
  | 'denied'
  | 'off'
  | 'on'
  | 'error'

export interface PushState {
  status: PushStatus
  busy: boolean
  /** Russian text for the user: what went wrong or what just happened. */
  message: string | null
  enable: () => Promise<void>
  disable: () => Promise<void>
  sendTest: () => Promise<void>
  recheck: () => Promise<void>
}

const SW_WAIT_MS = 8000
const SUBSCRIBE_WAIT_MS = 20_000

const PERMISSION_HINT =
  'Разрешите уведомления в запросе браузера. Если запроса не видно, нажмите на значок колокольчика или замка в адресной строке.'
const SUBSCRIBE_TIMEOUT_MESSAGE =
  'Браузер не дождался ответа от своего сервиса уведомлений (у Chrome это серверы Google). Попробуйте ещё раз позже или в другом браузере, например в Edge или Firefox.'

export function isIos(): boolean {
  const ua = navigator.userAgent
  // iPadOS 13+ says "Macintosh"; touch support gives it away.
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}

export function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

function initialStatus(): PushStatus {
  if (import.meta.env.VITE_DEMO === '1') return 'demo'
  if (isIos() && !isStandalone()) return 'ios-install'
  return pushSupported() ? 'checking' : 'unsupported'
}

function toInput(sub: PushSubscription): PushSubscriptionInput {
  const json = sub.toJSON()
  return { endpoint: sub.endpoint, keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' } }
}

async function swRegistration(): Promise<ServiceWorkerRegistration | null> {
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), SW_WAIT_MS))
  return Promise.race([navigator.serviceWorker.ready, timeout])
}

function describe(error: unknown): string {
  if (error instanceof ApiRequestError) return errorMessage(error)
  if (error instanceof DOMException && error.name === 'NotAllowedError') return 'Браузер запретил уведомления для этого сайта.'
  if (error instanceof TypeError) return errorMessage(error)
  return 'Браузер не смог подписаться на уведомления. Попробуйте ещё раз.'
}

/** Web push on this device: status and the actions of the «Уведомления» card. */
export function usePush(): PushState {
  const [status, setStatus] = useState<PushStatus>(initialStatus)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const ctx = useRef<{ registration: ServiceWorkerRegistration; publicKey: string } | null>(null)

  const recheck = useCallback(async () => {
    const first = initialStatus()
    if (first !== 'checking') {
      setStatus(first)
      return
    }
    try {
      const registration = await swRegistration()
      if (!registration) {
        setStatus('unsupported')
        setMessage('Сервис-воркер не запущен — обновите страницу.')
        return
      }
      const { publicKey } = await pushApi.publicKey()
      if (!publicKey) {
        setStatus('unconfigured')
        return
      }
      ctx.current = { registration, publicKey }
      if (Notification.permission === 'denied') {
        setStatus('denied')
        return
      }
      let sub = await registration.pushManager.getSubscription()
      // The server's key changed: the old subscription can no longer be used.
      if (sub && bytesToBase64Url(sub.options.applicationServerKey) !== publicKey) {
        await sub.unsubscribe()
        sub = null
      }
      if (!sub || Notification.permission !== 'granted') {
        setStatus('off')
        return
      }
      // Idempotent; also moves the subscription to whoever is signed in now.
      await pushApi.subscribe(toInput(sub))
      setStatus('on')
    } catch (error) {
      setStatus('error')
      setMessage(describe(error))
    }
  }, [])

  useEffect(() => {
    void recheck()
  }, [recheck])

  const enable = useCallback(async () => {
    const current = ctx.current
    if (!current) return
    setBusy(true)
    // Chrome may show the request only as a small icon in the address bar, so say where to look.
    setMessage(Notification.permission === 'granted' ? null : PERMISSION_HINT)
    try {
      // First await in the click handler: iOS only asks inside a user gesture.
      const permission = await Notification.requestPermission()
      setMessage(null)
      if (permission === 'denied') {
        setStatus('denied')
        return
      }
      if (permission !== 'granted') {
        setMessage('Чтобы получать уведомления, разрешите их в запросе браузера.')
        return
      }
      // The browser registers with its own push service (Google's for Chrome); that call may never return.
      const sub = await Promise.race([
        current.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64UrlToBytes(current.publicKey),
        }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), SUBSCRIBE_WAIT_MS)),
      ])
      if (!sub) {
        setMessage(SUBSCRIBE_TIMEOUT_MESSAGE)
        return
      }
      await pushApi.subscribe(toInput(sub))
      setStatus('on')
    } catch (error) {
      setMessage(describe(error))
    } finally {
      setBusy(false)
    }
  }, [])

  const disable = useCallback(async () => {
    const current = ctx.current
    if (!current) return
    setBusy(true)
    setMessage(null)
    try {
      const sub = await current.registration.pushManager.getSubscription()
      if (sub) {
        // Offline: the server drops it later, when the push service answers 410.
        await pushApi.unsubscribe({ endpoint: sub.endpoint }).catch(() => {})
        await sub.unsubscribe()
      }
      setStatus('off')
    } catch (error) {
      setMessage(describe(error))
    } finally {
      setBusy(false)
    }
  }, [])

  const sendTest = useCallback(async () => {
    setBusy(true)
    setMessage(null)
    try {
      await pushApi.sendTest()
      setMessage('Отправлено — уведомление придёт в течение минуты.')
    } catch (error) {
      setMessage(describe(error))
    } finally {
      setBusy(false)
    }
  }, [])

  return { status, busy, message, enable, disable, sendTest, recheck }
}
