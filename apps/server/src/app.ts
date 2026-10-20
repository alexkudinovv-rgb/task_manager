import Fastify, { type FastifyInstance } from 'fastify'
import type { Config } from './config'

// The system must never show up in search results (CC-242), so every response says so.
const NO_INDEX = 'noindex, nofollow, noarchive'

export function buildApp(config: Config): FastifyInstance {
  const app = Fastify({
    logger: config.NODE_ENV === 'test' ? false : { level: config.NODE_ENV === 'production' ? 'info' : 'debug' },
  })

  app.addHook('onSend', async (_request, reply) => {
    reply.header('X-Robots-Tag', NO_INDEX)
  })

  app.get('/robots.txt', async (_request, reply) => {
    reply.type('text/plain; charset=utf-8')
    return 'User-agent: *\nDisallow: /\n'
  })

  app.get('/api/health', async () => ({ status: 'ok' }))

  return app
}
