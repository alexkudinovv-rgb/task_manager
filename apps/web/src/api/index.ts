import type { WorkspaceDto } from '@car-city/shared/model'
import { mockApi } from './mock'
import { serverApi } from './server'

/** GitHub Pages build: mock data, no login, actions shown but not saved. */
export const DEMO = import.meta.env.VITE_DEMO === '1'

/** What both the demo and the real app read; the rest of the routes live on serverApi. */
export interface TaskApi {
  loadWorkspace(): Promise<WorkspaceDto>
}

export const api: TaskApi = DEMO ? mockApi : serverApi
export { serverApi }
