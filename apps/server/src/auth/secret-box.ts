import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

// AES-256-GCM for small secrets at rest (TOTP seeds). Format: v1:<iv>:<tag>:<ciphertext>, all base64url.
const VERSION = 'v1'
const ALGORITHM = 'aes-256-gcm'
const KEY_LENGTH = 32
const IV_LENGTH = 12
const TAG_LENGTH = 16

export function parseEncryptionKey(base64: string): Buffer {
  const value = base64.trim()
  // Buffer.from silently skips invalid characters, so check the shape first.
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) throw new Error('Encryption key must be base64')
  const key = Buffer.from(value, 'base64')
  if (key.length !== KEY_LENGTH) throw new Error(`Encryption key must be ${KEY_LENGTH} bytes, got ${key.length}`)
  return key
}

function assertKey(key: Buffer): void {
  if (key.length !== KEY_LENGTH) throw new Error(`Encryption key must be ${KEY_LENGTH} bytes`)
}

export function encryptSecret(plain: string, key: Buffer): string {
  assertKey(key)
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH })
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join(':')
}

// Throws on a wrong key, an unknown format or any tampering (GCM authentication failure).
export function decryptSecret(blob: string, key: Buffer): string {
  assertKey(key)
  const parts = blob.split(':')
  if (parts.length !== 4 || parts[0] !== VERSION) throw new Error('Unsupported encrypted secret format')
  const iv = Buffer.from(parts[1]!, 'base64url')
  const tag = Buffer.from(parts[2]!, 'base64url')
  const ciphertext = Buffer.from(parts[3]!, 'base64url')
  // A short tag would weaken authentication, so insist on the full length.
  if (iv.length !== IV_LENGTH || tag.length !== TAG_LENGTH) throw new Error('Malformed encrypted secret')
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH })
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}
