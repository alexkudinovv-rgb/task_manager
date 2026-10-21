import type { FastifyPluginAsync } from 'fastify'
import type { ModuleOptions } from '../types'

/** Task files: upload, list, download, delete. Routes: packages/shared/src/model/api.ts. */
export const attachmentRoutes: FastifyPluginAsync<ModuleOptions> = async () => {}
