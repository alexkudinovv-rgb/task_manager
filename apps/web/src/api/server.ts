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
