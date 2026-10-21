import { createHash, timingSafeEqual } from 'node:crypto'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { FakeTaskStore } from './fake-store'
import { createMcpServer } from './server'

export interface McpRoutesOptions {
  /** Shared bearer key for the spike (MCP_DEV_KEY). Per-user auth replaces it in stage 7. */
  key: string
  store?: FakeTaskStore
}

// Request headers that describe the original body/connection and must not be copied
// onto a body-less web Request (the body is handed over already parsed).
const SKIP_HEADERS = new Set(['content-length', 'transfer-encoding', 'connection', 'keep-alive', 'upgrade'])

const digest = (value: string) => createHash('sha256').update(value).digest()

function bearerToken(header: string | undefined): string | undefined {
  const match = header?.match(/^Bearer\s+(\S+)\s*$/i)
  return match?.[1]
}

function toWebRequest(request: FastifyRequest): Request {
  const headers = new Headers()
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined || SKIP_HEADERS.has(name)) continue
    for (const v of Array.isArray(value) ? value : [value]) headers.append(name, v)
  }
  return new Request(new URL(request.url, 'http://localhost'), { method: request.method, headers })
}

async function methodNotAllowed(_request: FastifyRequest, reply: FastifyReply) {
  return reply
    .code(405)
    .header('Allow', 'POST')
    .send({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed: this server is stateless, use POST.' },
      id: null,
    })
}

/**
 * Remote MCP endpoint (Streamable HTTP, stateless JSON mode) at /mcp.
 * Uses the SDK's web-standard transport and returns its Response through Fastify,
 * so the app-wide onSend hooks (X-Robots-Tag) still apply.
 */
export const mcpRoutes: FastifyPluginAsync<McpRoutesOptions> = async (app, options) => {
  const expected = digest(options.key)
  const store = options.store ?? new FakeTaskStore()

  // onRequest runs before body parsing, so unauthenticated bodies are never parsed.
  app.addHook('onRequest', async (request, reply) => {
    const token = bearerToken(request.headers.authorization)
    if (token !== undefined && timingSafeEqual(digest(token), expected)) return
    return reply
      .code(401)
      .header('WWW-Authenticate', 'Bearer realm="car-city-mcp"')
      .send({ error: 'unauthorized', message: 'Нужен заголовок Authorization: Bearer <ключ>' })
  })

  app.post('/mcp', async (request, reply) => {
    const server = createMcpServer(store)
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    })
    try {
      await server.connect(transport)
      // In JSON mode the Response is complete once this resolves, so closing afterwards is safe.
      return await transport.handleRequest(toWebRequest(request), { parsedBody: request.body })
    } catch (error) {
      request.log.error(error, 'MCP request failed')
      return reply.code(500).send({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null })
    } finally {
      await server.close()
    }
  })

  // Stateless mode has no standalone SSE stream and no sessions to delete.
  app.get('/mcp', methodNotAllowed)
  app.delete('/mcp', methodNotAllowed)
}
