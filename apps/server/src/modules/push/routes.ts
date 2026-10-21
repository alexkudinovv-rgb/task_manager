import { PushSubscriptionInput, PushUnsubscribeInput, type PushPublicKeyResponse } from '@car-city/shared/model'
import type { FastifyPluginAsync } from 'fastify'
import { apiError } from '../../http/errors'
import { requireActor } from '../../http/session'
import type { ModuleOptions } from '../types'
import { deleteSubscription, ensureVapid, isAllowedEndpoint, sendPushToUser, upsertSubscription } from './service'

/** Web push subscriptions (PWA) and a test notification. Routes: packages/shared/src/model/api.ts. */
export const pushRoutes: FastifyPluginAsync<ModuleOptions> = async (app, { db, config }) => {
  const configured = ensureVapid(config)

  app.get('/push/public-key', async (request): Promise<PushPublicKeyResponse> => {
    requireActor(request)
    return { publicKey: configured ? config.VAPID_PUBLIC_KEY! : null }
  })

  app.post('/push/subscriptions', async (request, reply) => {
    const actor = requireActor(request)
    const input = PushSubscriptionInput.parse(request.body)
    if (!isAllowedEndpoint(input.endpoint)) throw apiError(400, 'validation', { message: 'Unsupported push endpoint' })
    await upsertSubscription(db, actor.id, input)
    return reply.code(204).send()
  })

  app.delete('/push/subscriptions', async (request, reply) => {
    const actor = requireActor(request)
    const input = PushUnsubscribeInput.parse(request.body)
    await deleteSubscription(db, actor.id, input.endpoint)
    return reply.code(204).send()
  })

  app.post('/push/test', async (request, reply) => {
    const actor = requireActor(request)
    if (!configured) throw apiError(409, 'conflict', { message: 'Push is not configured on the server' })
    await sendPushToUser(
      db,
      config,
      actor.id,
      { title: 'Car City · Задачи', body: 'Тестовое уведомление', url: '/' },
      { log: request.log },
    )
    return reply.code(204).send()
  })
}
