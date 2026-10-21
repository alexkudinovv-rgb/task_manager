import websocket from '@fastify/websocket'
import { MessageInput } from '@car-city/shared/model'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireActor } from '../../http/session'
import type { ModuleOptions } from '../types'
import { liveHub } from './hub'
import { ChatService, PAGE_DEFAULT, PAGE_MAX, sessionAlive } from './service'

type WithChat = { Params: { chatKey: string } }
type WithId = { Params: { id: string } }

const PageQuery = z.object({
  before: z.iso.datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(PAGE_MAX).default(PAGE_DEFAULT),
})

/** Task chats, the general chat, unread counters and the /api/ws live channel. Routes: packages/shared/src/model/api.ts. */
export const chatRoutes: FastifyPluginAsync<ModuleOptions> = async (app, { db }) => {
  const service = new ChatService(db)

  app.get('/chats/unread', async (request) => service.unread(requireActor(request)))

  app.get<WithChat>('/chats/:chatKey/messages', async (request) => {
    const actor = requireActor(request)
    return service.page(actor, request.params.chatKey, PageQuery.parse(request.query))
  })

  app.post<WithChat>('/chats/:chatKey/messages', async (request, reply) => {
    const actor = requireActor(request)
    const message = await service.post(actor, request.params.chatKey, MessageInput.parse(request.body))
    reply.code(201)
    return message
  })

  app.post<WithChat>('/chats/:chatKey/read', async (request, reply) => {
    await service.markRead(requireActor(request), request.params.chatKey)
    return reply.code(204).send()
  })

  app.patch<WithId>('/messages/:id', async (request) => {
    const actor = requireActor(request)
    return service.edit(actor, request.params.id, MessageInput.parse(request.body))
  })

  app.delete<WithId>('/messages/:id', async (request, reply) => {
    await service.remove(requireActor(request), request.params.id)
    return reply.code(204).send()
  })

  // Live channel: server -> client WsEvent frames only; whatever the client sends is ignored.
  await app.register(websocket, { options: { maxPayload: 4096 } })
  app.get(
    '/ws',
    {
      websocket: true,
      // Runs before the upgrade: without a session the handshake is answered with a plain 401.
      preValidation: async (request) => {
        requireActor(request)
      },
    },
    (socket, request) => {
      const actor = request.actor!
      liveHub.add(socket, { id: actor.id, role: actor.role, stillValid: () => sessionAlive(db, actor.sessionId) })
    },
  )
}
