import type { Config } from '../config'
import { LocalStorage } from './local'
import { createS3Storage } from './s3'
import type { FileStorage } from './types'

export { assertStorageKey, StorageNotFoundError } from './types'
export type { FileStorage, PutMeta, StoredObject } from './types'

/** The driver chosen by FILE_STORAGE; call once at startup. */
export function createStorage(config: Config): FileStorage {
  return config.FILE_STORAGE === 's3' ? createS3Storage(config) : new LocalStorage(config.FILE_STORAGE_DIR)
}
