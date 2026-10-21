import type { FastifyPluginAsync } from 'fastify'
import type { ModuleOptions } from '../types'

/** Web push subscriptions (PWA) and a test notification. Routes: packages/shared/src/model/api.ts. */
export const pushRoutes: FastifyPluginAsync<ModuleOptions> = async () => {}
