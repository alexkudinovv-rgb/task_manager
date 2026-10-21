import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { Readable } from 'node:stream'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import type { Config } from '../config'
import { assertStorageKey, StorageNotFoundError, type FileStorage, type PutMeta, type StoredObject } from './types'

/** The one method the driver uses; tests pass a fake. */
export type S3Sender = Pick<S3Client, 'send'>

function isNotFound(error: unknown): boolean {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } }
  return e.name === 'NoSuchKey' || e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404
}

function toNodeStream(body: unknown): Readable {
  if (body instanceof Readable) return body
  if (body && typeof (body as WebReadableStream).getReader === 'function') return Readable.fromWeb(body as WebReadableStream)
  throw new Error('Unexpected S3 object body')
}

/** S3-compatible object storage (Yandex Object Storage, Selectel, MinIO, AWS). */
export class S3Storage implements FileStorage {
  constructor(
    private readonly client: S3Sender,
    private readonly bucket: string,
  ) {}

  async put(key: string, body: Readable, meta: PutMeta): Promise<void> {
    assertStorageKey(key)
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: meta.contentType,
        ContentLength: meta.size,
      }),
    )
  }

  async get(key: string): Promise<StoredObject> {
    assertStorageKey(key)
    try {
      const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }))
      if (!out.Body) throw new StorageNotFoundError(key)
      return { stream: toNodeStream(out.Body), size: out.ContentLength ?? 0 }
    } catch (error) {
      if (isNotFound(error)) throw new StorageNotFoundError(key)
      throw error
    }
  }

  async delete(key: string): Promise<void> {
    assertStorageKey(key)
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
    } catch (error) {
      if (!isNotFound(error)) throw error
    }
  }
}

export function createS3Storage(config: Config): S3Storage {
  const { S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = config
  const missing = Object.entries({ S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY })
    .filter(([, value]) => !value)
    .map(([name]) => name)
  if (missing.length > 0) throw new Error(`FILE_STORAGE=s3 needs ${missing.join(', ')}`)
  const client = new S3Client({
    endpoint: S3_ENDPOINT,
    region: S3_REGION,
    credentials: { accessKeyId: S3_ACCESS_KEY_ID!, secretAccessKey: S3_SECRET_ACCESS_KEY! },
    // Path-style URLs (endpoint/bucket/key) work with every S3-compatible provider.
    forcePathStyle: true,
    // Default CRC checksums use aws-chunked uploads that some S3-compatible providers reject.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  })
  return new S3Storage(client, S3_BUCKET!)
}
