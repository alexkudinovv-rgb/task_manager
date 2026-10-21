import { z } from 'zod'
import type { AllowedActions } from './policy'
import type { Role, Task } from './types'

/*
 * HTTP contract between apps/web and apps/server. All routes are under /api, JSON in and out.
 * Auth is a session cookie (httpOnly, SameSite=Lax) set by /auth/verify and /invites/:token/accept.
 *
 * Auth & invites (public unless noted)
 *   POST /api/auth/login            LoginInput            -> LoginResponse      (step 1: password)
 *   POST /api/auth/verify           VerifyInput           -> MeResponse + cookie (step 2: TOTP or recovery code)
 *   POST /api/auth/logout           (session)             -> 204, clears cookie
 *   POST /api/auth/logout-all       (session)             -> 204, ends every session of the user
 *   GET  /api/auth/me               (session)             -> MeResponse | 401
 *   GET  /api/invites/:token                              -> InviteInfo        (creates the TOTP secret on first open)
 *   POST /api/invites/:token/accept AcceptInviteInput     -> AcceptInviteResponse + cookie
 *
 * Users & directory (session)
 *   GET  /api/directory                                    -> DirectoryResponse
 *   POST /api/admin/users           CreateUserInput        -> CreateUserResponse (admins only)
 *   PATCH /api/admin/users/:id      UpdateUserInput        -> UserDto            (admins only; last admin stays)
 *   POST /api/admin/users/:id/invite                       -> InviteLinkResponse (admins only; resets password + 2FA)
 *   POST /api/admin/users/:id/disable                      -> UserDto            (admins only; ends sessions)
 *
 * Tasks (session; visibility and permissions from policy.ts)
 *   GET  /api/workspace                                    -> WorkspaceDto       (tasks the viewer can see)
 *   GET  /api/tasks/:id                                    -> TaskDetailsDto
 *   POST /api/tasks                 CreateTaskInput        -> Task               (parentId set = subtask)
 *   PATCH /api/tasks/:id            UpdateTaskInput        -> Task
 *   POST /api/tasks/:id/transition  TransitionInput        -> Task
 *   PUT  /api/tasks/:id/coexecutors CoexecutorsInput       -> Task
 *   POST /api/tasks/:id/checklist   ChecklistItemInput     -> ChecklistItemDto
 *   PATCH /api/checklist/:id        ChecklistItemPatch     -> ChecklistItemDto
 *   DELETE /api/checklist/:id                              -> 204
 *   POST /api/tasks/:id/due-requests DueChangeRequestInput -> DueRequestDto
 *   POST /api/due-requests/:id/decide DecideDueRequestInput -> TaskDetailsDto
 *
 * Errors: non-2xx responses carry ApiError. Status codes: 400 validation / policy input problems,
 * 401 no or expired session, 403 forbidden, 404 not found (also for tasks the viewer cannot see),
 * 409 conflicts (hot_limit, pending due request), 410 used/expired invite, 429 throttled.
 */

export const API_ERROR_CODES = [
  'unauthorized',
  'forbidden',
  'not_found',
  'validation',
  'invalid_credentials',
  'invalid_code',
  'challenge_expired',
  'throttled',
  'invite_invalid',
  'weak_password',
  'last_admin',
  'login_taken',
  'invalid_transition',
  'document_required',
  'comment_required',
  'hot_limit',
  'due_request_pending',
  'conflict',
  'internal',
] as const
export type ApiErrorCode = (typeof API_ERROR_CODES)[number]

export interface ApiError {
  error: ApiErrorCode
  message?: string
  /** zod issues for `validation`, password problems for `weak_password`. */
  details?: unknown
  /** For `throttled`. */
  retryAfterMs?: number
  /** For `hot_limit`: the responsible's other hot task. */
  conflictingTaskId?: string
}

// --- Users & directory ---

export interface UserDto {
  id: string
  login: string
  firstName: string
  lastName: string
  role: Role
  positionId: string | null
  unitId: string | null
  isAdmin: boolean
  disabled: boolean
}

export interface DirectoryItem {
  id: string
  name: string
}

export interface MeResponse {
  me: UserDto
}

export interface DirectoryResponse {
  users: UserDto[]
  positions: DirectoryItem[]
  units: DirectoryItem[]
}

/** Lowercase latin login chosen by the admin, e.g. `belova`. */
export const Login = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z][a-z0-9._-]{2,31}$/, 'Логин: 3–32 символа, латиница, цифры, точка, дефис, подчёркивание')

const Name = z.string().trim().min(1).max(60)
const NullableId = z.string().min(1).nullable()

export const CreateUserInput = z.object({
  login: Login,
  firstName: Name,
  lastName: Name,
  positionId: NullableId.default(null),
  unitId: NullableId.default(null),
  isAdmin: z.boolean().default(false),
})
export type CreateUserInput = z.infer<typeof CreateUserInput>

export const UpdateUserInput = z
  .object({
    firstName: Name,
    lastName: Name,
    positionId: NullableId,
    unitId: NullableId,
    isAdmin: z.boolean(),
  })
  .partial()
export type UpdateUserInput = z.infer<typeof UpdateUserInput>

export interface InviteLinkResponse {
  inviteUrl: string
  expiresAt: string
}

export interface CreateUserResponse extends InviteLinkResponse {
  user: UserDto
}

// --- Auth ---

export const LoginInput = z.object({
  login: Login,
  password: z.string().min(1).max(256),
})
export type LoginInput = z.infer<typeof LoginInput>

export interface LoginResponse {
  /** Short-lived (5 min) token for step 2. */
  challenge: string
}

export const TotpCode = z.string().trim().regex(/^\d{6}$/, 'Код — 6 цифр')

export const VerifyInput = z
  .object({
    challenge: z.string().min(1),
    code: TotpCode.optional(),
    recoveryCode: z.string().trim().min(1).max(64).optional(),
  })
  .refine((input) => Boolean(input.code) !== Boolean(input.recoveryCode), {
    message: 'Нужен либо код из приложения, либо резервный код',
  })
export type VerifyInput = z.infer<typeof VerifyInput>

export interface InviteInfo {
  login: string
  firstName: string
  lastName: string
  /** Base32 secret to type in by hand when the QR code can't be scanned. */
  totpSecret: string
  otpauthUri: string
}

export const AcceptInviteInput = z.object({
  password: z.string().min(1).max(256),
  code: TotpCode,
})
export type AcceptInviteInput = z.infer<typeof AcceptInviteInput>

export interface AcceptInviteResponse extends MeResponse {
  /** Shown once; the server keeps only hashes. */
  recoveryCodes: string[]
}

// --- Tasks ---

export interface WorkspaceDto extends DirectoryResponse {
  me: UserDto
  /** Visible top-level tasks and visible subtasks (`parentId` set). */
  tasks: Task[]
}

export interface ChecklistItemDto {
  id: string
  text: string
  done: boolean
  sort: number
}

export interface TaskEventDto {
  id: string
  type: string
  actorId: string | null
  at: string
  payload: Record<string, unknown>
}

export interface DueRequestDto {
  id: string
  taskId: string
  requestedBy: string
  newDueDate: string
  newDueTime: string | null
  reason: string
  state: 'pending' | 'approved' | 'rejected'
  createdAt: string
}

export interface TaskDetailsDto {
  task: Task
  parent: Task | null
  subtasks: Task[]
  checklist: ChecklistItemDto[]
  events: TaskEventDto[]
  pendingDueRequest: DueRequestDto | null
  allowedActions: AllowedActions
}

export const CoexecutorsInput = z.object({ userIds: z.array(z.string().min(1)).max(20) })
export type CoexecutorsInput = z.infer<typeof CoexecutorsInput>

export const ChecklistItemInput = z.object({ text: z.string().trim().min(1).max(500) })
export type ChecklistItemInput = z.infer<typeof ChecklistItemInput>

export const ChecklistItemPatch = z
  .object({ text: z.string().trim().min(1).max(500), done: z.boolean() })
  .partial()
export type ChecklistItemPatch = z.infer<typeof ChecklistItemPatch>

export const DecideDueRequestInput = z.object({
  approve: z.boolean(),
  comment: z.string().trim().max(1000).optional(),
})
export type DecideDueRequestInput = z.infer<typeof DecideDueRequestInput>
