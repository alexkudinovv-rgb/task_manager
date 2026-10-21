import { randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import type { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { assertStorageKey, StorageNotFoundError, type FileStorage, type PutMeta, type StoredObject } from './types'

const isMissing = (error: unknown) => (error as { code?: string }).code === 'ENOENT'

/** Files under a folder (dev, tests, a mounted volume). `dir` is resolved against process.cwd(). */
export class LocalStorage implements FileStorage {
  readonly root: string

  constructor(dir: string) {
    this.root = resolve(process.cwd(), dir)
  }

  /** Absolute path of `key`, guaranteed to stay inside the root. */
  private pathOf(key: string): string {
    assertStorageKey(key)
    const path = resolve(this.root, key)
    if (!path.startsWith(this.root + sep)) throw new Error(`Storage key escapes the root: ${key}`)
    return path
  }

  async put(key: string, body: Readable, _meta: PutMeta): Promise<void> {
    const path = this.pathOf(key)
    await mkdir(dirname(path), { recursive: true })
    // Written aside and renamed, so a reader never sees half a file.
    const partial = `${path}.${randomUUID()}.part`
    try {
      await pipeline(body, createWriteStream(partial, { flags: 'wx' }))
      await rename(partial, path)
    } catch (error) {
      await rm(partial, { force: true })
      throw error
    }
  }

  async get(key: string): Promise<StoredObject> {
    const path = this.pathOf(key)
    try {
      const info = await stat(path)
      if (!info.isFile()) throw new StorageNotFoundError(key)
      return { stream: createReadStream(path), size: info.size }
    } catch (error) {
      if (isMissing(error)) throw new StorageNotFoundError(key)
      throw error
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathOf(key), { force: true })
  }
}
