import { randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Transform, type Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import fastifyMultipart from '@fastify/multipart'
import { ATTACHMENT_MAX_BYTES } from '@car-city/shared/model'
import type { FastifyPluginAsync } from 'fastify'
import { apiError } from '../../http/errors'
import { requireActor } from '../../http/session'
import { createStorage, StorageNotFoundError } from '../../storage'
import type { ModuleOptions } from '../types'
import { contentDisposition, detectMime, INLINE_TYPES, sanitizeFileName, SNIFF_BYTES } from './files'
import { AttachmentService } from './service'

type WithId = { Params: { id: string } }

const TOO_LARGE_MESSAGE = 'Файл больше 25 МБ'
const tooLarge = () => apiError(413, 'validation', { message: TOO_LARGE_MESSAGE })
const noFile = () => apiError(400, 'validation', { message: 'Выберите файл (поле file)' })

interface Spooled {
  path: string
  size: number
  head: Buffer
}

/**
 * Streams the upload to a temp file: the exact size is known before the object store sees it
 * (S3 needs Content-Length) and nothing larger than a chunk is held in memory.
 */
async function spool(body: Readable): Promise<Spooled> {
  const path = join(tmpdir(), `cc-upload-${randomUUID()}`)
  const result: Spooled = { path, size: 0, head: Buffer.alloc(0) }
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      result.size += chunk.length
      if (result.head.length < SNIFF_BYTES) {
        result.head = Buffer.concat([result.head, chunk.subarray(0, SNIFF_BYTES - result.head.length)])
      }
      done(null, chunk)
    },
  })
  try {
    await pipeline(body, meter, createWriteStream(path, { flags: 'wx' }))
  } catch (error) {
    await rm(path, { force: true })
    throw error
  }
  return result
}

const isFileTooLarge = (error: unknown) => {
  const code = (error as { code?: string }).code
  return code === 'FST_REQ_FILE_TOO_LARGE' || code === 'FST_FILES_LIMIT' || code === 'FST_PARTS_LIMIT'
}

/** Task files: upload, list, download, delete. Routes: packages/shared/src/model/api.ts. */
export const attachmentRoutes: FastifyPluginAsync<ModuleOptions> = async (app, { db, config }) => {
  const service = new AttachmentService(db)
  const storage = createStorage(config)

  // Scoped to this plugin: only these routes accept multipart bodies.
  await app.register(fastifyMultipart, {
    limits: { fileSize: ATTACHMENT_MAX_BYTES, files: 1, fields: 5, parts: 6 },
  })

  app.get<WithId>('/tasks/:id/attachments', async (request) => service.list(requireActor(request), request.params.id))

  app.post<WithId>('/tasks/:id/attachments', async (request, reply) => {
    const actor = requireActor(request)
    // Permission first, so a forbidden upload is refused before its body is read.
    const task = await service.assertCanUpload(actor, request.params.id)
    if (!request.isMultipart()) throw noFile()

    let spooled: Spooled | undefined
    try {
      const part = await request.file()
      if (!part) throw noFile()
      if (part.fieldname !== 'file') {
        part.file.resume()
        throw noFile()
      }
      spooled = await spool(part.file)
      // Busboy stops the stream at the limit and marks it truncated instead of failing.
      if (part.file.truncated || spooled.size > ATTACHMENT_MAX_BYTES) throw tooLarge()
      if (spooled.size === 0) throw apiError(400, 'validation', { message: 'Файл пустой' })

      const mime = detectMime(spooled.head, part.mimetype)
      const storageKey = `tasks/${task.id}/${randomUUID()}`
      await storage.put(storageKey, createReadStream(spooled.path), { contentType: mime, size: spooled.size })
      try {
        const dto = await service.create(actor, task.id, {
          storageKey,
          fileName: sanitizeFileName(part.filename),
          sizeBytes: spooled.size,
          mime,
        })
        reply.code(201)
        return dto
      } catch (error) {
        await storage.delete(storageKey).catch((cleanup) => request.log.error(cleanup, 'orphaned upload not removed'))
        throw error
      }
    } catch (error) {
      if (isFileTooLarge(error)) throw tooLarge()
      throw error
    } finally {
      if (spooled) await rm(spooled.path, { force: true })
    }
  })

  app.get<WithId>('/attachments/:id', async (request, reply) => {
    const row = await service.findVisible(requireActor(request), request.params.id)
    let object
    try {
      object = await storage.get(row.storageKey)
    } catch (error) {
      if (error instanceof StorageNotFoundError) {
        request.log.error({ attachmentId: row.id, storageKey: row.storageKey }, 'attachment object missing')
        throw apiError(404, 'not_found', { message: 'Файл не найден в хранилище' })
      }
      throw error
    }
    const inline = INLINE_TYPES.has(row.mime)
    reply
      .type(row.mime)
      .header('Content-Length', object.size)
      .header('Content-Disposition', contentDisposition(inline ? 'inline' : 'attachment', row.fileName))
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'private, max-age=0')
    // Downloads never render, but if one is opened directly it gets no scripts or origin.
    if (!inline) reply.header('Content-Security-Policy', "default-src 'none'; sandbox")
    return reply.send(object.stream)
  })

  app.delete<WithId>('/attachments/:id', async (request, reply) => {
    const storageKey = await service.remove(requireActor(request), request.params.id)
    // The row is gone, so the file is unreachable either way; a leftover object is only logged.
    await storage.delete(storageKey).catch((error) => request.log.warn({ err: error, storageKey }, 'attachment object not deleted'))
    return reply.code(204).send()
  })
}
