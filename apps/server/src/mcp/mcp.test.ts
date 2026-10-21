import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../app'
import { loadConfig } from '../config'

const KEY = 'test-mcp-key-0123456789'
const TOOL_NAMES = ['add_comment', 'change_status', 'create_task', 'list_tasks', 'who_is_busy']

const app = buildApp(loadConfig({ NODE_ENV: 'test', MCP_DEV_KEY: KEY }))

afterAll(() => app.close())

let nextId = 1

async function rpc(method: string, params: Record<string, unknown> = {}, key = KEY) {
  const response = await app.inject({
    method: 'POST',
    url: '/mcp',
    headers: {
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    payload: { jsonrpc: '2.0', id: nextId++, method, params },
  })
  return response
}

/** The transport may answer with plain JSON or a single SSE event; accept both. */
function parseRpc(body: string, contentType: string | undefined) {
  if (contentType?.includes('text/event-stream')) {
    const data = body
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('')
    return JSON.parse(data)
  }
  return JSON.parse(body)
}

async function callTool(name: string, args: Record<string, unknown>) {
  const response = await rpc('tools/call', { name, arguments: args })
  expect(response.statusCode).toBe(200)
  return parseRpc(response.body, response.headers['content-type'] as string).result
}

describe('MCP endpoint auth', () => {
  it('rejects requests without a key', async () => {
    const response = await app.inject({ method: 'POST', url: '/mcp', payload: {} })
    expect(response.statusCode).toBe(401)
    expect(response.headers['www-authenticate']).toMatch(/^Bearer/)
    expect(response.json()).toMatchObject({ error: 'unauthorized' })
    expect(response.headers['x-robots-tag']).toBe('noindex, nofollow, noarchive')
  })

  it('rejects a wrong key', async () => {
    const response = await rpc('tools/list', {}, 'wrong-key-wrong-key-123')
    expect(response.statusCode).toBe(401)
  })

  it('answers GET with 405 (stateless, no SSE stream)', async () => {
    const response = await app.inject({ method: 'GET', url: '/mcp', headers: { authorization: `Bearer ${KEY}` } })
    expect(response.statusCode).toBe(405)
  })

  it('is absent when MCP_DEV_KEY is not configured', async () => {
    const plain = buildApp(loadConfig({ NODE_ENV: 'test' }))
    const response = await plain.inject({ method: 'POST', url: '/mcp', payload: {} })
    expect(response.statusCode).toBe(404)
    await plain.close()
  })
})

describe('MCP protocol over inject', () => {
  it('initializes', async () => {
    const response = await rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'vitest', version: '0.0.0' },
    })
    expect(response.statusCode).toBe(200)
    expect(response.headers['x-robots-tag']).toBe('noindex, nofollow, noarchive')
    const message = parseRpc(response.body, response.headers['content-type'] as string)
    expect(message.result.serverInfo.name).toBe('car-city-tasks')
    expect(message.result.capabilities.tools).toBeDefined()
  })

  it('lists the five task tools', async () => {
    const response = await rpc('tools/list')
    expect(response.statusCode).toBe(200)
    const message = parseRpc(response.body, response.headers['content-type'] as string)
    const names = message.result.tools.map((t: { name: string }) => t.name).sort()
    expect(names).toEqual(TOOL_NAMES)
  })

  it('refuses to create a task for an unknown person and lists valid names', async () => {
    const result = await callTool('create_task', {
      title: 'Тестовая задача',
      responsible: 'Василий Неизвестный',
      due_date: '2030-01-15',
    })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Мария Смирнова')
    expect(result.structuredContent.valid_responsibles).toContain('Иван Петров')
  })

  it('creates a task for a known person', async () => {
    const result = await callTool('create_task', {
      title: 'Подготовить машину к выдаче',
      responsible: 'Иван',
      due_date: '2030-01-15',
      due_time: '12:30',
      priority: 'hot',
    })
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent.task).toMatchObject({
      responsible: 'Иван Петров',
      status: 'new',
      priority: 'hot',
      due_date: '2030-01-15',
    })
  })

  it('rejects an impossible due date', async () => {
    const result = await callTool('create_task', { title: 'Задача', responsible: 'Иван Петров', due_date: '2030-02-30' })
    expect(result.isError).toBe(true)
  })

  it('changes status, comments and filters', async () => {
    const changed = await callTool('change_status', { task_id: 2, status: 'in_progress', comment: 'Взял в работу' })
    expect(changed.isError).toBeFalsy()
    expect(changed.structuredContent.task.status).toBe('in_progress')

    const commented = await callTool('add_comment', { task_id: 2, text: 'Жду документы' })
    expect(commented.structuredContent.task.comments).toHaveLength(2)

    const missing = await callTool('add_comment', { task_id: 999, text: 'x' })
    expect(missing.isError).toBe(true)

    const overdue = await callTool('list_tasks', { only_overdue: true })
    expect(overdue.structuredContent.tasks.every((t: { overdue: boolean }) => t.overdue)).toBe(true)

    const busy = await callTool('who_is_busy', {})
    expect(busy.structuredContent.people).toHaveLength(4)
  })
})

describe('MCP protocol with the SDK client over real HTTP', () => {
  let server: FastifyInstance
  let url: URL

  beforeAll(async () => {
    server = buildApp(loadConfig({ NODE_ENV: 'test', MCP_DEV_KEY: KEY }))
    const address = await server.listen({ host: '127.0.0.1', port: 0 })
    url = new URL('/mcp', address)
  })

  afterAll(() => server.close())

  it('connects, lists tools and calls one', async () => {
    const client = new Client({ name: 'vitest-client', version: '0.0.0' })
    const transport = new StreamableHTTPClientTransport(url, {
      requestInit: { headers: { Authorization: `Bearer ${KEY}` } },
    })
    await client.connect(transport)
    try {
      const { tools } = await client.listTools()
      expect(tools.map((t) => t.name).sort()).toEqual(TOOL_NAMES)

      const result = await client.callTool({ name: 'who_is_busy', arguments: {} })
      expect(result.isError).toBeFalsy()
      expect(JSON.stringify(result.content)).toContain('Загрузка сотрудников')
    } finally {
      await client.close()
    }
  })

  it('fails to connect with a wrong key', async () => {
    const client = new Client({ name: 'vitest-client', version: '0.0.0' })
    const transport = new StreamableHTTPClientTransport(url, {
      requestInit: { headers: { Authorization: 'Bearer wrong-key-wrong-key-123' } },
    })
    await expect(client.connect(transport)).rejects.toThrow()
  })
})
