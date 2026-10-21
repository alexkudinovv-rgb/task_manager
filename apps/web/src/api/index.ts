import type { Role, Task } from '@car-city/shared/model'
import { mockApi } from './mock'

/** Editable directory entry (positions and units are lists in the settings). */
export interface DirectoryItem {
  id: string
  name: string
}

export interface User {
  id: string
  firstName: string
  lastName: string
  role: Role
  positionId: string | null
  unitId: string | null
}

export interface Workspace {
  users: User[]
  positions: DirectoryItem[]
  units: DirectoryItem[]
  /** Top-level tasks and their subtasks (`parentId` set). */
  tasks: Task[]
}

/** The UI talks only to this contract; the HTTP client replaces the mock once the server exists. */
export interface TaskApi {
  loadWorkspace(): Promise<Workspace>
}

export const api: TaskApi = mockApi
