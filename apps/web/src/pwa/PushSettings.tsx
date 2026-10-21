import { usePush, type PushStatus } from './usePush'
import './pwa.css'

const STATUS: Record<PushStatus, { label: string; tone: 'on' | 'off' | 'warn'; hint: string | null }> = {
  checking: { label: 'Проверяем…', tone: 'off', hint: null },
  demo: { label: 'Недоступно в демо', tone: 'off', hint: 'На тестовом сайте нет сервера, поэтому уведомления не приходят.' },
  'ios-install': {
    label: 'Нужно установить приложение',
    tone: 'warn',
    hint: null,
  },
  unsupported: { label: 'Не поддерживается', tone: 'off', hint: 'Этот браузер не умеет получать push-уведомления.' },
  unconfigured: { label: 'Не настроено на сервере', tone: 'off', hint: 'Попросите администратора включить push-уведомления.' },
  denied: {
    label: 'Запрещено в браузере',
    tone: 'warn',
    hint: 'Разрешите уведомления для этого сайта в настройках браузера или телефона, затем обновите страницу.',
  },
  off: { label: 'Выключены', tone: 'off', hint: 'Уведомления придут со звуком, даже когда приложение закрыто.' },
  on: { label: 'Включены на этом устройстве', tone: 'on', hint: null },
  error: { label: 'Не удалось проверить', tone: 'warn', hint: null },
}

/** «Уведомления на этом устройстве»: status, enable / disable, test push. */
export function PushSettings() {
  const push = usePush()
  const info = STATUS[push.status]
  const disabled = push.status === 'demo'

  return (
    <section className={`card pwa-push${disabled ? ' is-disabled' : ''}`} aria-labelledby="pwa-push-title">
      <div className="pwa-push-head">
        <h2 id="pwa-push-title" className="pwa-push-title">
          Уведомления на этом устройстве
        </h2>
        <span className={`pwa-push-status tone-${info.tone}`}>{info.label}</span>
      </div>

      {push.status === 'ios-install' ? (
        <div className="pwa-push-hint">
          <p>На iPhone и iPad уведомления приходят только в установленное приложение (iOS 16.4 и новее):</p>
          <ol>
            <li>
              откройте сайт в Safari и нажмите <b>Поделиться</b> → <b>На экран «Домой»</b>;
            </li>
            <li>запустите «Задачи» с экрана «Домой»;</li>
            <li>вернитесь сюда и нажмите «Включить уведомления».</li>
          </ol>
        </div>
      ) : (
        info.hint && <p className="pwa-push-hint">{info.hint}</p>
      )}

      {push.message && (
        <p className="pwa-push-message" role="status">
          {push.message}
        </p>
      )}

      <div className="pwa-push-actions">
        {(push.status === 'off' || disabled) && (
          <button type="button" className="btn btn-primary btn-sm" disabled={disabled || push.busy} onClick={() => void push.enable()}>
            Включить уведомления
          </button>
        )}
        {push.status === 'on' && (
          <>
            <button type="button" className="btn btn-secondary btn-sm" disabled={push.busy} onClick={() => void push.sendTest()}>
              Прислать тестовое
            </button>
            <button type="button" className="btn btn-secondary btn-sm" disabled={push.busy} onClick={() => void push.disable()}>
              Отключить
            </button>
          </>
        )}
        {push.status === 'error' && (
          <button type="button" className="btn btn-secondary btn-sm" disabled={push.busy} onClick={() => void push.recheck()}>
            Повторить
          </button>
        )}
      </div>
    </section>
  )
}
