import type {
  AcceptInviteInput,
  AcceptInviteResponse,
  ChecklistItemDto,
  ChecklistItemInput,
  ChecklistItemPatch,
  CoexecutorsInput,
  CreateTaskInput,
  CreateUserInput,
  CreateUserResponse,
  DecideDueRequestInput,
  DirectoryResponse,
  DueChangeRequestInput,
  DueRequestDto,
  InviteInfo,
  InviteLinkResponse,
  LoginInput,
  LoginResponse,
  MeResponse,
  Task,
  TaskDetailsDto,
  TransitionInput,
  UpdateTaskInput,
  UpdateUserInput,
  UserDto,
  VerifyInput,
  WorkspaceDto,
} from '@car-city/shared/model'
import { request } from './http'

const seg = encodeURIComponent

/** Every route of packages/shared/src/model/api.ts, one method each. */
export const serverApi = {
  // Auth & invites
  me: () => request<MeResponse>('GET', '/auth/me'),
  login: (input: LoginInput) => request<LoginResponse>('POST', '/auth/login', input),
  verify: (input: VerifyInput) => request<MeResponse>('POST', '/auth/verify', input),
  logout: () => request<void>('POST', '/auth/logout'),
  logoutAll: () => request<void>('POST', '/auth/logout-all'),
  invite: (token: string) => request<InviteInfo>('GET', `/invites/${seg(token)}`),
  acceptInvite: (token: string, input: AcceptInviteInput) =>
    request<AcceptInviteResponse>('POST', `/invites/${seg(token)}/accept`, input),

  // Users & directory
  directory: () => request<DirectoryResponse>('GET', '/directory'),
  createUser: (input: CreateUserInput) => request<CreateUserResponse>('POST', '/admin/users', input),
  updateUser: (userId: string, input: UpdateUserInput) => request<UserDto>('PATCH', `/admin/users/${seg(userId)}`, input),
  reinviteUser: (userId: string) => request<InviteLinkResponse>('POST', `/admin/users/${seg(userId)}/invite`),
  disableUser: (userId: string) => request<UserDto>('POST', `/admin/users/${seg(userId)}/disable`),

  // Tasks
  loadWorkspace: () => request<WorkspaceDto>('GET', '/workspace'),
  taskDetails: (taskId: string) => request<TaskDetailsDto>('GET', `/tasks/${seg(taskId)}`),
  createTask: (input: CreateTaskInput) => request<Task>('POST', '/tasks', input),
  updateTask: (taskId: string, input: UpdateTaskInput) => request<Task>('PATCH', `/tasks/${seg(taskId)}`, input),
  transition: (taskId: string, input: TransitionInput) => request<Task>('POST', `/tasks/${seg(taskId)}/transition`, input),
  setCoexecutors: (taskId: string, input: CoexecutorsInput) =>
    request<Task>('PUT', `/tasks/${seg(taskId)}/coexecutors`, input),
  addChecklistItem: (taskId: string, input: ChecklistItemInput) =>
    request<ChecklistItemDto>('POST', `/tasks/${seg(taskId)}/checklist`, input),
  updateChecklistItem: (itemId: string, patch: ChecklistItemPatch) =>
    request<ChecklistItemDto>('PATCH', `/checklist/${seg(itemId)}`, patch),
  deleteChecklistItem: (itemId: string) => request<void>('DELETE', `/checklist/${seg(itemId)}`),
  requestDueChange: (taskId: string, input: DueChangeRequestInput) =>
    request<DueRequestDto>('POST', `/tasks/${seg(taskId)}/due-requests`, input),
  decideDueRequest: (requestId: string, input: DecideDueRequestInput) =>
    request<TaskDetailsDto>('POST', `/due-requests/${seg(requestId)}/decide`, input),
}

// ---------- Task attachments ----------
// Imports kept with this block (hoisted by the module system) so it can be appended as a unit.
import type { ApiError, AttachmentDto } from '@car-city/shared/model'
import { ApiRequestError } from './http'

export interface UploadOptions {
  /** Bytes sent so far and the request body size; fires as the browser streams the file. */
  onProgress?: (loaded: number, total: number) => void
  signal?: AbortSignal
}

const UPLOAD_FALLBACK: Record<number, ApiError['error']> = {
  400: 'validation',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  413: 'validation',
}

/**
 * Multipart upload through XMLHttpRequest: fetch has no upload progress. Same-origin cookies go
 * along by default. Rejects with ApiRequestError like `request`, or a DOMException on abort.
 */
function uploadAttachment(taskId: string, file: File, options: UploadOptions = {}): Promise<AttachmentDto> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const abort = () => xhr.abort()
    const done = () => options.signal?.removeEventListener('abort', abort)
    xhr.open('POST', `/api/tasks/${seg(taskId)}/attachments`)
    xhr.setRequestHeader('Accept', 'application/json')
    xhr.responseType = 'text'
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) options.onProgress?.(event.loaded, event.total)
    }
    xhr.onload = () => {
      done()
      let body: unknown = null
      try {
        body = xhr.responseText ? JSON.parse(xhr.responseText) : null
      } catch {
        body = null
      }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(body as AttachmentDto)
      const apiError =
        body && typeof (body as ApiError).error === 'string'
          ? (body as ApiError)
          : { error: UPLOAD_FALLBACK[xhr.status] ?? 'internal', ...(xhr.status === 413 ? { message: 'Файл больше 25 МБ' } : {}) }
      reject(new ApiRequestError(xhr.status, apiError as ApiError))
    }
    xhr.onerror = () => {
      done()
      reject(new TypeError('Network error'))
    }
    xhr.onabort = () => {
      done()
      reject(new DOMException('Upload aborted', 'AbortError'))
    }
    if (options.signal?.aborted) return reject(new DOMException('Upload aborted', 'AbortError'))
    options.signal?.addEventListener('abort', abort)
    const form = new FormData()
    form.append('file', file, file.name)
    xhr.send(form)
  })
}

/** /api/tasks/:id/attachments and /api/attachments/:id (see packages/shared/src/model/api.ts). */
export const attachmentApi = {
  list: (taskId: string) => request<AttachmentDto[]>('GET', `/tasks/${seg(taskId)}/attachments`),
  upload: uploadAttachment,
  remove: (attachmentId: string) => request<void>('DELETE', `/attachments/${seg(attachmentId)}`),
}

// ---------- Web push ----------
import type { PushPublicKeyResponse, PushSubscriptionInput, PushUnsubscribeInput } from '@car-city/shared/model'

/** /api/push/* (see packages/shared/src/model/api.ts). */
export const pushApi = {
  publicKey: () => request<PushPublicKeyResponse>('GET', '/push/public-key'),
  subscribe: (input: PushSubscriptionInput) => request<void>('POST', '/push/subscriptions', input),
  unsubscribe: (input: PushUnsubscribeInput) => request<void>('DELETE', '/push/subscriptions', input),
  sendTest: () => request<void>('POST', '/push/test'),
}

// ---------- Chats ----------
import type { ChatKey, MessageDto, MessageInput, MessagesPage, UnreadDto } from '@car-city/shared/model'

/** /api/chats/* and /api/messages/* (see packages/shared/src/model/api.ts); live events come over /api/ws. */
export const chatApi = {
  /** Newest first; pass the previous page's `nextBefore` as `before` for older messages. */
  messages: (chatKey: ChatKey, before?: string | null, limit?: number) => {
    const query = new URLSearchParams()
    if (before) query.set('before', before)
    if (limit) query.set('limit', String(limit))
    const qs = query.toString()
    return request<MessagesPage>('GET', `/chats/${seg(chatKey)}/messages${qs ? `?${qs}` : ''}`)
  },
  post: (chatKey: ChatKey, input: MessageInput) => request<MessageDto>('POST', `/chats/${seg(chatKey)}/messages`, input),
  edit: (messageId: string, input: MessageInput) => request<MessageDto>('PATCH', `/messages/${seg(messageId)}`, input),
  remove: (messageId: string) => request<void>('DELETE', `/messages/${seg(messageId)}`),
  markRead: (chatKey: ChatKey) => request<void>('POST', `/chats/${seg(chatKey)}/read`),
  unread: () => request<UnreadDto>('GET', '/chats/unread'),
}
