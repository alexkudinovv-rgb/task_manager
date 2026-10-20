import { afterAll, describe, expect, it } from 'vitest'
import { buildApp } from './app'
import { loadConfig } from './config'

const app = buildApp(loadConfig({ NODE_ENV: 'test' }))

afterAll(() => app.close())

describe('server skeleton', () => {
  it('reports health', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'ok' })
  })

  it('marks every response as noindex, including 404s', async () => {
    for (const url of ['/api/health', '/robots.txt', '/no-such-page']) {
      const response = await app.inject({ method: 'GET', url })
      expect(response.headers['x-robots-tag']).toBe('noindex, nofollow, noarchive')
    }
  })

  it('disallows all crawlers in robots.txt', async () => {
    const response = await app.inject({ method: 'GET', url: '/robots.txt' })
    expect(response.body).toBe('User-agent: *\nDisallow: /\n')
  })
})

describe('config', () => {
  it('rejects an invalid port', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(/Invalid environment/)
  })
})
