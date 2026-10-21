import fastifyCookie from '@fastify/cookie'
import fastifyStatic from '@fastify/static'
import Fastify, { type FastifyInstance } from 'fastify'
import type { Config } from './config'
import type { Db } from './db/client'
import { installErrorHandler } from './http/errors'
import { installSecurityHeaders } from './http/security-headers'
import { installSessionAuth } from './http/session'
import { mcpRoutes } from './mcp/routes'
import { attachmentRoutes } from './modules/attachments/routes'
import { authRoutes } from './modules/auth/routes'
import { chatRoutes } from './modules/chats/routes'
import { pushRoutes } from './modules/push/routes'
import { taskRoutes } from './modules/tasks/routes'

// The system must never show up in search results (CC-242), so every response says so.
const NO_INDEX = 'noindex, nofollow, noarchive'

export interface AppDeps {
  /** Without a database the API modules are not mounted (static demo, health, MCP spike only). */
  db?: Db
}

export function buildApp(config: Config, deps: AppDeps = {}): FastifyInstance {
  const app = Fastify({
    logger: config.NODE_ENV === 'test' ? false : { level: config.NODE_ENV === 'production' ? 'info' : 'debug' },
    // In production the app sits behind exactly one proxy (Railway / Caddy). Trusting one hop takes the
    // client IP from the address that proxy appended, so a client-sent X-Forwarded-For can't spoof it.
    // Trust only hop 0 (the proxy that connected to us), i.e. one hop; outside production trust nothing.
    trustProxy: (_address: string, hop: number) => config.NODE_ENV === 'production' && hop === 0,
  })

  installErrorHandler(app)
  installSecurityHeaders(app, config)
  app.register(fastifyCookie)

  app.addHook('onSend', async (_request, reply) => {
    reply.header('X-Robots-Tag', NO_INDEX)
  })

  app.get('/robots.txt', async (_request, reply) => {
    reply.type('text/plain; charset=utf-8')
    return 'User-agent: *\nDisallow: /\n'
  })

  app.get('/api/health', async () => ({ status: 'ok' }))

  if (deps.db) {
    installSessionAuth(app, deps.db)
    app.register(authRoutes, { prefix: '/api', db: deps.db, config })
    app.register(taskRoutes, { prefix: '/api', db: deps.db, config })
    app.register(chatRoutes, { prefix: '/api', db: deps.db, config })
    app.register(attachmentRoutes, { prefix: '/api', db: deps.db, config })
    app.register(pushRoutes, { prefix: '/api', db: deps.db, config })
  }

  // MCP spike: only exposed when a dev key is configured.
  if (config.MCP_DEV_KEY) {
    app.register(mcpRoutes, { key: config.MCP_DEV_KEY })
  }

  // One origin for the app and the API: the server hands out the built web app.
  if (config.WEB_DIST) {
    app.register(fastifyStatic, { root: config.WEB_DIST, index: 'index.html' })
    app.setNotFoundHandler((request, reply) => {
      if (request.method === 'GET' && !request.url.startsWith('/api/')) return reply.sendFile('index.html')
      return reply.code(404).send({ error: 'not_found' })
    })
  }

  return app
}
