import type { Department, Status, Task, User } from '@car-city/shared'
import { mockApi } from './mock'

export interface Workspace {
  statuses: Status[]
  departments: Department[]
  users: User[]
  tasks: Task[]
}

/** The UI talks only to this contract; the HTTP client replaces the mock once the server exists. */
export interface TaskApi {
  loadWorkspace(): Promise<Workspace>
}

export const api: TaskApi = mockApi
