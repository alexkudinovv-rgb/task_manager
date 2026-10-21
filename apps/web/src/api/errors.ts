import type { ApiError, ApiErrorCode } from '@car-city/shared/model'
import { plural } from '../dates'
import { ApiRequestError } from './http'

/** A problem found before the request is sent; its message is already for the user. */
export class FormError extends Error {}

const MESSAGES: Record<ApiErrorCode, string> = {
  unauthorized: 'Сессия закончилась — войдите снова.',
  forbidden: 'Недостаточно прав для этого действия.',
  not_found: 'Не найдено: возможно, запись удалена или недоступна вам.',
  validation: 'Проверьте заполнение полей.',
  invalid_credentials: 'Неверный логин или пароль.',
  invalid_code: 'Неверный код. Проверьте время на телефоне и введите новый код.',
  challenge_expired: 'Время на ввод кода истекло. Войдите заново.',
  throttled: 'Слишком много попыток.',
  invite_invalid: 'Ссылка недействительна, попросите новую у администратора.',
  weak_password: 'Пароль слишком простой.',
  last_admin: 'Это последний администратор — сначала назначьте другого.',
  login_taken: 'Такой логин уже занят.',
  invalid_transition: 'Статус задачи уже изменился. Обновите страницу.',
  document_required: 'Прикрепите документ — загрузка файлов появится позже.',
  comment_required: 'Нужен комментарий.',
  hot_limit: 'У ответственного уже есть горящая задача — вторую поставить нельзя.',
  due_request_pending: 'Запрос на перенос срока уже ждёт решения постановщика.',
  conflict: 'Данные успели измениться. Обновите страницу.',
  internal: 'Ошибка на сервере. Попробуйте ещё раз чуть позже.',
}

export function apiErrorBody(error: unknown): ApiError | null {
  return error instanceof ApiRequestError ? error.body : null
}

export function errorCode(error: unknown): ApiErrorCode | null {
  return apiErrorBody(error)?.error ?? null
}

export function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiRequestError && error.status === 401
}

export function errorMessage(error: unknown): string {
  if (error instanceof FormError) return error.message
  const body = apiErrorBody(error)
  if (!body) return 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.'
  if (body.error === 'throttled') return throttledMessage(body.retryAfterMs)
  if (body.error === 'validation') {
    const hints = russianIssues(body.details)
    if (hints.length > 0) return `${MESSAGES.validation} ${hints.join('; ')}`
  }
  // The server may explain other cases more precisely (in Russian); these keep our wording.
  const serverText = !OUR_WORDING.has(body.error) && body.message && /[а-яё]/i.test(body.message) ? body.message : null
  return serverText ?? MESSAGES[body.error]
}

const OUR_WORDING = new Set<ApiErrorCode>([
  'invalid_credentials',
  'challenge_expired',
  'invite_invalid',
  'weak_password',
  'hot_limit',
  'document_required',
  'internal',
])

function throttledMessage(retryAfterMs?: number): string {
  if (!retryAfterMs) return `${MESSAGES.throttled} Попробуйте позже.`
  const minutes = Math.max(1, Math.ceil(retryAfterMs / 60_000))
  return `${MESSAGES.throttled} Попробуйте через ${minutes} ${plural(minutes, ['минуту', 'минуты', 'минут'])}.`
}

/** Messages out of a details list: strings or objects with `message` (zod issues). */
function messages(details: unknown): string[] {
  const list = Array.isArray(details)
    ? details
    : typeof details === 'object' && details !== null
      ? (Object.values(details).find(Array.isArray) ?? [])
      : []
  return list
    .map((item: unknown) => {
      if (typeof item === 'string') return item
      if (typeof item === 'object' && item !== null && typeof (item as { message?: unknown }).message === 'string') {
        return (item as { message: string }).message
      }
      return null
    })
    .filter((text): text is string => Boolean(text))
}

// Shared schemas carry Russian messages for user-facing rules; zod's own defaults are English and stay hidden.
function russianIssues(details: unknown): string[] {
  return [...new Set(messages(details).filter((text) => /[а-яё]/i.test(text)))]
}

const PASSWORD_PROBLEMS: Record<string, string> = {
  too_short: 'Слишком короткий пароль — нужно не меньше 10 символов.',
  too_long: 'Слишком длинный пароль.',
  equals_login: 'Пароль не должен совпадать с логином.',
}

/** For `weak_password`: what is wrong with the password (details are problem codes, the message is their text). */
export function passwordProblems(error: unknown): string[] {
  const body = apiErrorBody(error)
  if (body?.error !== 'weak_password') return []
  const known = messages(body.details)
    .map((code) => PASSWORD_PROBLEMS[code] ?? (/[а-яё]/i.test(code) ? code : null))
    .filter((text): text is string => Boolean(text))
  if (known.length > 0) return known
  return body.message ? body.message.split('. ').filter(Boolean) : []
}
