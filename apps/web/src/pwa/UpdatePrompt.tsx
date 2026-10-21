import { useSyncExternalStore } from 'react'
import { applyUpdate, dismissUpdate, updateState } from './register'
import './pwa.css'

/** Shown when a new version of the app is downloaded and waiting. */
export function UpdatePrompt() {
  const needRefresh = useSyncExternalStore(updateState.subscribe, updateState.needRefresh, () => false)
  if (!needRefresh) return null
  return (
    <div className="pwa-update" role="status">
      <span>Доступна новая версия</span>
      <button type="button" className="btn btn-primary btn-sm" onClick={applyUpdate}>
        Обновить
      </button>
      <button type="button" className="btn btn-secondary btn-sm" onClick={dismissUpdate}>
        Позже
      </button>
    </div>
  )
}
