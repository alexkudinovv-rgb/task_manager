import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { text } from 'node:stream/consumers'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { loadConfig } from '../config'
import { createStorage, StorageNotFoundError } from './index'
import { LocalStorage } from './local'
import { createS3Storage, S3Storage } from './s3'

const BAD_KEYS = ['../escape', 'tasks/../../x', '/abs', 'C:\\win', 'a//b', 'tasks/x/', '', 'a/./b', 'tasks\\x', 'имя']

describe('LocalStorage', () => {
  let dir: string
  let storage: LocalStorage

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cc-storage-test-'))
    storage = new LocalStorage(dir)
  })
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('puts, gets and deletes objects under nested keys', async () => {
    await storage.put('tasks/t1/f1', Readable.from([Buffer.from('привет')]), { contentType: 'text/plain', size: 12 })
    expect(await readFile(join(dir, 'tasks', 't1', 'f1'), 'utf8')).toBe('привет')
    expect(await readdir(join(dir, 'tasks', 't1'))).toEqual(['f1'])

    const object = await storage.get('tasks/t1/f1')
    expect(object.size).toBe(12)
    expect(await text(object.stream)).toBe('привет')

    await storage.delete('tasks/t1/f1')
    await expect(storage.get('tasks/t1/f1')).rejects.toBeInstanceOf(StorageNotFoundError)
    await storage.delete('tasks/t1/f1')
  })

  it('leaves no partial file when the source stream fails', async () => {
    const failing = new Readable({
      read() {
        this.destroy(new Error('boom'))
      },
    })
    await expect(storage.put('tasks/t2/f', failing, { contentType: 'x/y', size: 1 })).rejects.toThrow('boom')
    expect(await readdir(join(dir, 'tasks', 't2'))).toEqual([])
  })

  it('refuses keys that could leave the root', async () => {
    for (const key of BAD_KEYS) {
      await expect(storage.get(key), key).rejects.toThrow(/Invalid storage key/)
      await expect(storage.delete(key), key).rejects.toThrow(/Invalid storage key/)
      await expect(storage.put(key, Readable.from([]), { contentType: 'x/y', size: 0 }), key).rejects.toThrow(/Invalid storage key/)
    }
  })

  it('resolves a relative FILE_STORAGE_DIR against the working directory', () => {
    const local = createStorage(loadConfig({ NODE_ENV: 'test', FILE_STORAGE_DIR: './some-files' }))
    expect(local).toBeInstanceOf(LocalStorage)
    expect((local as LocalStorage).root).toBe(join(process.cwd(), 'some-files'))
  })
})

describe('S3Storage', () => {
  const fake = () => {
    const send = vi.fn()
    return { send, storage: new S3Storage({ send } as unknown as S3Client, 'car-city-files') }
  }

  it('uploads with bucket, key, type and length', async () => {
    const { send, storage } = fake()
    send.mockResolvedValue({})
    const body = Readable.from([Buffer.from('data')])
    await storage.put('tasks/t/f', body, { contentType: 'application/pdf', size: 4 })
    const command = send.mock.calls[0]![0]
    expect(command).toBeInstanceOf(PutObjectCommand)
    expect(command.input).toEqual({
      Bucket: 'car-city-files',
      Key: 'tasks/t/f',
      Body: body,
      ContentType: 'application/pdf',
      ContentLength: 4,
    })
  })

  it('downloads as a Node stream with its size', async () => {
    const { send, storage } = fake()
    send.mockResolvedValue({ Body: Readable.from([Buffer.from('файл')]), ContentLength: 8 })
    const object = await storage.get('tasks/t/f')
    expect(send.mock.calls[0]![0]).toBeInstanceOf(GetObjectCommand)
    expect(send.mock.calls[0]![0].input).toEqual({ Bucket: 'car-city-files', Key: 'tasks/t/f' })
    expect(object.size).toBe(8)
    expect(await text(object.stream)).toBe('файл')
  })

  it('accepts web streams as bodies', async () => {
    const { send, storage } = fake()
    send.mockResolvedValue({ Body: new Blob(['web']).stream(), ContentLength: 3 })
    expect(await text((await storage.get('k')).stream)).toBe('web')
  })

  it('maps missing objects to StorageNotFoundError and other errors through', async () => {
    const { send, storage } = fake()
    send.mockRejectedValueOnce(Object.assign(new Error('nope'), { name: 'NoSuchKey' }))
    await expect(storage.get('tasks/t/f')).rejects.toBeInstanceOf(StorageNotFoundError)
    send.mockRejectedValueOnce(Object.assign(new Error('nope'), { name: 'Unknown', $metadata: { httpStatusCode: 404 } }))
    await expect(storage.get('tasks/t/f')).rejects.toBeInstanceOf(StorageNotFoundError)
    send.mockRejectedValueOnce(Object.assign(new Error('denied'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } }))
    await expect(storage.get('tasks/t/f')).rejects.toThrow('denied')
  })

  it('deletes idempotently', async () => {
    const { send, storage } = fake()
    send.mockResolvedValueOnce({})
    await storage.delete('tasks/t/f')
    expect(send.mock.calls[0]![0]).toBeInstanceOf(DeleteObjectCommand)
    send.mockRejectedValueOnce(Object.assign(new Error('gone'), { name: 'NoSuchKey' }))
    await expect(storage.delete('tasks/t/f')).resolves.toBeUndefined()
    send.mockRejectedValueOnce(new Error('network'))
    await expect(storage.delete('tasks/t/f')).rejects.toThrow('network')
  })

  it('refuses bad keys before calling S3', async () => {
    const { send, storage } = fake()
    for (const key of BAD_KEYS) await expect(storage.get(key)).rejects.toThrow(/Invalid storage key/)
    expect(send).not.toHaveBeenCalled()
  })

  it('is configured from the environment, path-style, and insists on credentials', async () => {
    const env = {
      NODE_ENV: 'test',
      FILE_STORAGE: 's3',
      S3_ENDPOINT: 'https://storage.yandexcloud.net',
      S3_BUCKET: 'car-city-files',
      S3_ACCESS_KEY_ID: 'id',
      S3_SECRET_ACCESS_KEY: 'secret',
    }
    const storage = createStorage(loadConfig(env))
    expect(storage).toBeInstanceOf(S3Storage)
    const client = (storage as unknown as { client: S3Client }).client
    expect(client.config.forcePathStyle).toBe(true)
    expect(await client.config.region()).toBe('ru-central1')
    expect(await client.config.requestChecksumCalculation()).toBe('WHEN_REQUIRED')
    const endpoint = await client.config.endpoint!()
    expect(endpoint.hostname).toBe('storage.yandexcloud.net')

    expect(() => createS3Storage(loadConfig({ ...env, S3_SECRET_ACCESS_KEY: undefined }))).toThrow(/S3_SECRET_ACCESS_KEY/)
    expect(() => createS3Storage(loadConfig({ ...env, S3_BUCKET: undefined }))).toThrow(/S3_BUCKET/)
  })
})
