import type { FastifyPluginAsync } from 'fastify'
import type { ModuleOptions } from '../types'

/** Task chats, the general chat, unread counters and the /api/ws live channel. Routes: packages/shared/src/model/api.ts. */
export const chatRoutes: FastifyPluginAsync<ModuleOptions> = async () => {}
