import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { decryptSecret, encryptSecret, parseEncryptionKey } from './secret-box'

const key = randomBytes(32)

function flipFirstByte(base64url: string): string {
  const bytes = Buffer.from(base64url, 'base64url')
  bytes[0] = bytes[0]! ^ 1
  return bytes.toString('base64url')
}

describe('secret box', () => {
  it('round-trips, including non-ASCII text', () => {
    for (const plain of ['JBSWY3DPEHPK3PXP', '', 'секрет 🔐']) {
      expect(decryptSecret(encryptSecret(plain, key), key)).toBe(plain)
    }
  })

  it('uses the versioned v1:<iv>:<tag>:<ciphertext> format with a fresh IV each time', () => {
    const blob = encryptSecret('JBSWY3DPEHPK3PXP', key)
    expect(blob).toMatch(/^v1:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]+$/)
    expect(blob).not.toContain('JBSWY3DPEHPK3PXP')
    expect(encryptSecret('JBSWY3DPEHPK3PXP', key)).not.toBe(blob)
  })

  it('fails with the wrong key', () => {
    const blob = encryptSecret('JBSWY3DPEHPK3PXP', key)
    expect(() => decryptSecret(blob, randomBytes(32))).toThrow()
  })

  it('fails when any part is tampered with', () => {
    const [version, iv, tag, ciphertext] = encryptSecret('JBSWY3DPEHPK3PXP', key).split(':') as [string, string, string, string]
    expect(() => decryptSecret([version, iv, tag, flipFirstByte(ciphertext)].join(':'), key)).toThrow()
    expect(() => decryptSecret([version, iv, flipFirstByte(tag), ciphertext].join(':'), key)).toThrow()
    expect(() => decryptSecret([version, flipFirstByte(iv), tag, ciphertext].join(':'), key)).toThrow()
  })

  it('rejects unknown versions, truncated tags and malformed blobs', () => {
    const [, iv, tag, ciphertext] = encryptSecret('JBSWY3DPEHPK3PXP', key).split(':') as [string, string, string, string]
    expect(() => decryptSecret(['v2', iv, tag, ciphertext].join(':'), key)).toThrow(/format/)
    const shortTag = Buffer.from(tag, 'base64url').subarray(0, 4).toString('base64url')
    expect(() => decryptSecret(['v1', iv, shortTag, ciphertext].join(':'), key)).toThrow(/Malformed/)
    expect(() => decryptSecret('garbage', key)).toThrow()
  })

  it('refuses keys of the wrong length', () => {
    expect(() => encryptSecret('x', randomBytes(16))).toThrow(/32 bytes/)
    expect(() => decryptSecret(encryptSecret('x', key), randomBytes(31))).toThrow(/32 bytes/)
  })
})

describe('parseEncryptionKey', () => {
  it('accepts a base64 or base64url 32-byte key', () => {
    const raw = randomBytes(32)
    expect(parseEncryptionKey(raw.toString('base64')).equals(raw)).toBe(true)
    expect(parseEncryptionKey(` ${raw.toString('base64url')}\n`).equals(raw)).toBe(true)
  })

  it('rejects keys of the wrong length or not base64', () => {
    expect(() => parseEncryptionKey(randomBytes(16).toString('base64'))).toThrow(/32 bytes/)
    expect(() => parseEncryptionKey(randomBytes(33).toString('base64'))).toThrow(/32 bytes/)
    expect(() => parseEncryptionKey('')).toThrow()
    expect(() => parseEncryptionKey('not a key!')).toThrow(/base64/)
  })
})
