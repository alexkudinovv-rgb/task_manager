import fastifyStatic from '@fastify/static'
import Fastify, { type FastifyInstance } from 'fastify'
import type { Config } from './config'
import { mcpRoutes } from './mcp/routes'

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

  // MCP spike: only exposed when a dev key is configured.
  if (config.MCP_DEV_KEY) {
    app.register(mcpRoutes, { key: config.MCP_DEV_KEY })
  }

  // One origin for the app and the API: the server hands out the built web app.
  if (config.WEB_DIST) {
    app.register(fastifyStatic, { root: config.WEB_DIST, index: 'index.html' })
    app.setNotFoundHandler((request, reply) => {
      if (request.method === 'GET' && !request.url.startsWith('/api/')) return reply.sendFile('index.html')
      return reply.code(404).send({ error: 'Not Found' })
    })
  }

  return app
}
