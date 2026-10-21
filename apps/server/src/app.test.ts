import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

describe('serving the built web app', () => {
  const dist = mkdtempSync(join(tmpdir(), 'web-dist-'))
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>demo</title>')
  const web = buildApp(loadConfig({ NODE_ENV: 'test', WEB_DIST: dist }))

  afterAll(async () => {
    await web.close()
    rmSync(dist, { recursive: true, force: true })
  })

  it('serves index.html at / and for unknown non-API paths', async () => {
    for (const url of ['/', '/tasks/123']) {
      const response = await web.inject({ method: 'GET', url })
      expect(response.statusCode).toBe(200)
      expect(response.body).toContain('<title>demo</title>')
      expect(response.headers['x-robots-tag']).toBe('noindex, nofollow, noarchive')
    }
  })

  it('keeps unknown API paths as JSON 404', async () => {
    const response = await web.inject({ method: 'GET', url: '/api/nope' })
    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'not_found' })
  })
})

describe('config', () => {
  it('rejects an invalid port', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(/Invalid environment/)
  })
})
