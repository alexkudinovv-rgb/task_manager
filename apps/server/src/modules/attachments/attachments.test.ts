import { randomBytes } from 'node:crypto'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { ATTACHMENT_MAX_BYTES, type AttachmentDto, type Task } from '@car-city/shared/model'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../app'
import { hashToken } from '../../auth'
import { loadConfig } from '../../config'
import { attachments, messages, sessions, users } from '../../db/schema'
import { LocalStorage } from '../../storage/local'
import { createTestDb, TEST_DATABASE_URL, type TestDb } from '../../test/test-db'

type Who = 'owner' | 'alpha' | 'beta' | 'gamma' | 'delta'
type Method = 'GET' | 'POST' | 'DELETE'

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(64)])
const PDF = Buffer.from('%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n')
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
const HTML = Buffer.from('<!doctype html><script>alert(document.cookie)</script>')

interface FilePart {
  field?: string
  name: string
  type: string
  content: Buffer
}

/** A multipart/form-data body built by hand, as a browser would send it (UTF-8 file names). */
function multipart(parts: FilePart[]) {
  const boundary = `----cc${randomBytes(8).toString('hex')}`
  const chunks: Buffer[] = []
  for (const part of parts) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${part.field ?? 'file'}"; filename="${part.name}"\r\n` +
          `Content-Type: ${part.type}\r\n\r\n`,
      ),
      part.content,
      Buffer.from('\r\n'),
    )
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`))
  return { payload: Buffer.concat(chunks), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } }
}

describe.skipIf(!TEST_DATABASE_URL)('attachments API', { timeout: 30_000 }, () => {
  let testDb: TestDb
  let app: FastifyInstance
  let storageDir: string
  const ids = {} as Record<Who, string>
  const tokens = {} as Record<Who, string>

  beforeAll(async () => {
    storageDir = await mkdtemp(join(tmpdir(), 'cc-files-test-'))
    testDb = await createTestDb()
    app = buildApp(loadConfig({ NODE_ENV: 'test', FILE_STORAGE_DIR: storageDir }), { db: testDb.db })
    await app.ready()
    const people: [Who, 'owner' | 'director'][] = [
      ['owner', 'owner'],
      ['alpha', 'director'],
      ['beta', 'director'],
      ['gamma', 'director'],
      ['delta', 'director'],
    ]
    for (const [who, role] of people) {
      const [user] = await testDb.db
        .insert(users)
        .values({ login: who, firstName: who, lastName: 'Тестов', role, isAdmin: role === 'owner', passwordHash: 'x' })
        .returning()
      const token = randomBytes(32).toString('base64url')
      await testDb.db
        .insert(sessions)
        .values({ userId: user!.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 86_400_000) })
      ids[who] = user!.id
      tokens[who] = token
    }
  }, 60_000)

  afterAll(async () => {
    await app?.close()
    testDb?.pool.on('error', () => {})
    await testDb?.drop()
    if (storageDir) await rm(storageDir, { recursive: true, force: true })
  }, 60_000)

  const cookies = (who: Who | null): Record<string, string> => (who ? { cc_session: tokens[who] } : {})
  const call = (who: Who | null, method: Method, url: string, payload?: object) =>
    app.inject({ method, url, payload, cookies: cookies(who) })
  const upload = (who: Who | null, taskId: string, ...parts: FilePart[]) =>
    app.inject({ method: 'POST', url: `/api/tasks/${taskId}/attachments`, cookies: cookies(who), ...multipart(parts) })

  async function uploaded(who: Who, taskId: string, part: FilePart): Promise<AttachmentDto> {
    const response = await upload(who, taskId, part)
    expect(response.statusCode, response.body).toBe(201)
    return response.json<AttachmentDto>()
  }

  async function create(who: Who, body: Record<string, unknown>): Promise<Task> {
    const response = await call(who, 'POST', '/api/tasks', { title: 'Задача', dueDate: '2026-11-20', ...body })
    expect(response.statusCode, response.body).toBe(201)
    return response.json<Task>()
  }

  const list = async (who: Who, taskId: string) => {
    const response = await call(who, 'GET', `/api/tasks/${taskId}/attachments`)
    expect(response.statusCode, response.body).toBe(200)
    return response.json<AttachmentDto[]>()
  }

  const storedFiles = async (taskId: string) => readdir(join(storageDir, 'tasks', taskId)).catch(() => [] as string[])
  const spoolLeftovers = async () => (await readdir(tmpdir())).filter((name) => name.startsWith('cc-upload-'))

  // alpha sets, beta is responsible, gamma helps; delta is a stranger.
  let task: Task
  beforeAll(async () => {
    task = await create('alpha', { responsibleId: ids.beta, coexecutorIds: [ids.gamma] })
  })

  it('uploads a file, stores it under a server key and lists it newest first', async () => {
    const first = await uploaded('gamma', task.id, { name: 'фото склада.png', type: 'image/png', content: PNG })
    expect(first).toMatchObject({
      taskId: task.id,
      messageId: null,
      fileName: 'фото склада.png',
      sizeBytes: PNG.length,
      mime: 'image/png',
      uploadedBy: ids.gamma,
      url: `/api/attachments/${first.id}`,
    })
    const [row] = await testDb.db.select().from(attachments).where(eq(attachments.id, first.id))
    expect(row!.storageKey).toMatch(new RegExp(`^tasks/${task.id}/[0-9a-f-]{36}$`))
    expect(await storedFiles(task.id)).toHaveLength(1)

    const second = await uploaded('alpha', task.id, { name: 'акт.pdf', type: 'application/pdf', content: PDF })
    const seen = await list('beta', task.id)
    expect(seen.map((a) => a.id)).toEqual([second.id, first.id])
    expect(await list('owner', task.id)).toHaveLength(2)
    expect(await spoolLeftovers()).toEqual([])
  })

  it('serves previewable types inline and the rest as downloads, never sniffed', async () => {
    const png = await uploaded('beta', task.id, { name: 'схема.png', type: 'image/png', content: PNG })
    const pdf = await uploaded('beta', task.id, { name: 'договор.pdf', type: 'application/octet-stream', content: PDF })
    const svg = await uploaded('beta', task.id, { name: 'logo.svg', type: 'image/svg+xml', content: SVG })
    const html = await uploaded('beta', task.id, { name: 'page.html', type: 'text/html', content: HTML })
    // An HTML page claiming to be an image is stored as an opaque binary.
    const fake = await uploaded('beta', task.id, { name: 'cat.png', type: 'image/png', content: HTML })
    expect(pdf.mime).toBe('application/pdf')
    expect(fake.mime).toBe('application/octet-stream')

    const download = (a: AttachmentDto) => call('gamma', 'GET', a.url)

    const pngResponse = await download(png)
    expect(pngResponse.statusCode).toBe(200)
    expect(pngResponse.rawPayload.equals(PNG)).toBe(true)
    expect(pngResponse.headers).toMatchObject({
      'content-type': 'image/png',
      'content-length': String(PNG.length),
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, max-age=0',
    })
    expect(pngResponse.headers['content-disposition']).toBe(
      `inline; filename="_____.png"; filename*=UTF-8''${encodeURIComponent('схема.png')}`,
    )
    // Previews keep the app-wide policy; only downloads get the sandbox.
    expect(pngResponse.headers['content-security-policy'] ?? '').not.toContain('sandbox')

    const pdfResponse = await download(pdf)
    expect(pdfResponse.headers['content-type']).toBe('application/pdf')
    expect(pdfResponse.headers['content-disposition']).toMatch(/^inline;/)

    for (const [a, type] of [
      [svg, 'image/svg+xml'],
      [html, 'text/html'],
      [fake, 'application/octet-stream'],
    ] as const) {
      const response = await download(a)
      expect(response.statusCode).toBe(200)
      expect(response.headers['content-type']).toContain(type)
      expect(response.headers['content-disposition']).toMatch(/^attachment; filename="[^"]+"; filename\*=UTF-8''/)
      expect(response.headers['x-content-type-options']).toBe('nosniff')
      expect(response.headers['content-security-policy']).toContain('sandbox')
    }
  })

  it('cleans file names for display', async () => {
    const odd = await uploaded('beta', task.id, { name: '..\\..\\секрет‮gnp.exe', type: 'application/x-msdownload', content: PDF })
    expect(odd.fileName).toBe('секретgnp.exe')
    const long = await uploaded('beta', task.id, { name: `${'я'.repeat(300)}.docx`, type: 'application/msword', content: HTML })
    expect(Array.from(long.fileName)).toHaveLength(200)
    expect(long.fileName.endsWith('.docx')).toBe(true)
  })

  it('rejects files over 25 MB with 413 and keeps nothing', async () => {
    const before = (await list('alpha', task.id)).length
    const filesBefore = (await storedFiles(task.id)).length
    const response = await upload('alpha', task.id, {
      name: 'big.bin',
      type: 'application/octet-stream',
      content: Buffer.alloc(ATTACHMENT_MAX_BYTES + 1),
    })
    expect(response.statusCode).toBe(413)
    expect(response.json()).toMatchObject({ error: 'validation', message: 'Файл больше 25 МБ' })
    expect(await list('alpha', task.id)).toHaveLength(before)
    expect(await storedFiles(task.id)).toHaveLength(filesBefore)
    expect(await spoolLeftovers()).toEqual([])

    const exact = await upload('alpha', task.id, {
      name: 'ровно.bin',
      type: 'application/octet-stream',
      content: Buffer.alloc(ATTACHMENT_MAX_BYTES, 1),
    })
    expect(exact.statusCode, exact.body).toBe(201)
  })

  it('refuses bodies without a file', async () => {
    const wrongField = await upload('alpha', task.id, { field: 'doc', name: 'a.pdf', type: 'application/pdf', content: PDF })
    expect(wrongField.statusCode).toBe(400)
    const empty = await upload('alpha', task.id, { name: 'пусто.txt', type: 'text/plain', content: Buffer.alloc(0) })
    expect(empty.statusCode).toBe(400)
    const json = await call('alpha', 'POST', `/api/tasks/${task.id}/attachments`, { file: 'x' })
    expect(json.statusCode).toBe(400)
    expect(json.json()).toMatchObject({ error: 'validation' })
  })

  it('answers 404 to people who cannot see the task, 401 without a session', async () => {
    const [a] = await list('alpha', task.id)
    for (const response of [
      await call('delta', 'GET', `/api/tasks/${task.id}/attachments`),
      await upload('delta', task.id, { name: 'x.pdf', type: 'application/pdf', content: PDF }),
      await call('delta', 'GET', a!.url),
      await call('delta', 'DELETE', a!.url),
      await call('alpha', 'GET', '/api/attachments/not-a-uuid'),
      await call('alpha', 'GET', `/api/attachments/${task.id}`),
      await call('alpha', 'GET', '/api/tasks/not-a-uuid/attachments'),
    ]) {
      expect(response.statusCode, response.body).toBe(404)
      expect(response.json()).toMatchObject({ error: 'not_found' })
    }
    expect((await call(null, 'GET', a!.url)).statusCode).toBe(401)
    expect((await upload(null, task.id, { name: 'x.pdf', type: 'application/pdf', content: PDF })).statusCode).toBe(401)
  })

  it('lets subtask participants see the parent task files', async () => {
    const sub = await create('beta', { responsibleId: ids.delta, parentId: task.id })
    const [a] = await list('delta', task.id)
    expect((await call('delta', 'GET', a!.url)).statusCode).toBe(200)
    await uploaded('delta', sub.id, { name: 'отчёт.pdf', type: 'application/pdf', content: PDF })
  })

  it('lets the uploader, the task author and the owner delete files', async () => {
    const t = await create('alpha', { responsibleId: ids.beta, coexecutorIds: [ids.gamma] })
    const byGamma = await uploaded('gamma', t.id, { name: '1.pdf', type: 'application/pdf', content: PDF })
    const byBeta = await uploaded('beta', t.id, { name: '2.pdf', type: 'application/pdf', content: PDF })
    const byBeta2 = await uploaded('beta', t.id, { name: '3.pdf', type: 'application/pdf', content: PDF })
    const byGamma2 = await uploaded('gamma', t.id, { name: '4.pdf', type: 'application/pdf', content: PDF })
    expect(await storedFiles(t.id)).toHaveLength(4)

    // The responsible is neither uploader nor author.
    const denied = await call('beta', 'DELETE', byGamma.url)
    expect(denied.statusCode).toBe(403)
    expect(denied.json()).toMatchObject({ error: 'forbidden' })

    expect((await call('gamma', 'DELETE', byGamma.url)).statusCode).toBe(204)
    expect((await call('alpha', 'DELETE', byBeta.url)).statusCode).toBe(204)
    expect((await call('owner', 'DELETE', byBeta2.url)).statusCode).toBe(204)
    expect((await call('gamma', 'DELETE', byGamma.url)).statusCode).toBe(404)
    expect((await list('alpha', t.id)).map((a) => a.id)).toEqual([byGamma2.id])
    expect(await storedFiles(t.id)).toHaveLength(1)

    // A missing object: download is a 404, deleting the row still works.
    await rm(join(storageDir, 'tasks', t.id), { recursive: true, force: true })
    expect((await call('alpha', 'GET', byGamma2.url)).statusCode).toBe(404)
    expect((await call('gamma', 'DELETE', byGamma2.url)).statusCode).toBe(204)
  })

  it('needs the document to complete a task, then freezes files once it is done', async () => {
    const t = await create('alpha', { responsibleId: ids.beta, requiresDocument: true })
    expect((await call('beta', 'POST', `/api/tasks/${t.id}/transition`, { to: 'in_progress' })).statusCode).toBe(200)

    const early = await call('beta', 'POST', `/api/tasks/${t.id}/transition`, { to: 'done' })
    expect(early.statusCode).toBe(400)
    expect(early.json()).toMatchObject({ error: 'document_required' })

    const doc = await uploaded('beta', t.id, { name: 'акт выполненных работ.pdf', type: 'application/pdf', content: PDF })
    const done = await call('beta', 'POST', `/api/tasks/${t.id}/transition`, { to: 'done' })
    expect(done.statusCode, done.body).toBe(200)
    expect(done.json<Task>()).toMatchObject({ status: 'done', attachmentCount: 1 })

    const late = await upload('beta', t.id, { name: 'ещё.pdf', type: 'application/pdf', content: PDF })
    expect(late.statusCode).toBe(403)
    expect(late.json()).toMatchObject({ error: 'forbidden' })
    expect((await call('alpha', 'DELETE', doc.url)).statusCode).toBe(403)
    expect((await call('owner', 'DELETE', doc.url)).statusCode).toBe(403)
    // Still readable.
    expect(await list('beta', t.id)).toHaveLength(1)
    expect((await call('beta', 'GET', doc.url)).statusCode).toBe(200)
  })

  it('opens chat files by the chat: general for everyone, task chats by task visibility', async () => {
    const files = new LocalStorage(storageDir)
    const put = async (taskId: string | null, deleted = false) => {
      const [message] = await testDb.db
        .insert(messages)
        .values({ taskId, authorId: ids.alpha, body: 'файл', deletedAt: deleted ? new Date() : null })
        .returning()
      const [row] = await testDb.db
        .insert(attachments)
        .values({
          messageId: message!.id,
          storageKey: `chats/${message!.id}`,
          fileName: 'чат.pdf',
          sizeBytes: PDF.length,
          mime: 'application/pdf',
          uploadedBy: ids.alpha,
        })
        .returning()
      await files.put(row!.storageKey, Readable.from([PDF]), { contentType: 'application/pdf', size: PDF.length })
      return `/api/attachments/${row!.id}`
    }
    const general = await put(null)
    const inTask = await put(task.id)
    const gone = await put(null, true)
    const privateTask = await create('alpha', { responsibleId: ids.alpha })
    const hidden = await put(privateTask.id)

    expect((await call('delta', 'GET', general)).statusCode).toBe(200)
    expect((await call('gamma', 'GET', inTask)).statusCode).toBe(200)
    expect((await call('gamma', 'GET', hidden)).statusCode).toBe(404)
    expect((await call('alpha', 'GET', gone)).statusCode).toBe(404)
    // Chat files go with their message, not through this route.
    expect((await call('alpha', 'DELETE', general)).statusCode).toBe(403)
    // Task lists show task files only.
    expect((await list('alpha', task.id)).every((a) => a.taskId === task.id)).toBe(true)
  })
})
