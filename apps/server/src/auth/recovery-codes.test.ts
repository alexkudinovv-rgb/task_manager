import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { findMatchingRecoveryCode, generateRecoveryCodes, hashRecoveryCode, normalizeRecoveryCode } from './recovery-codes'

describe('generateRecoveryCodes', () => {
  it('produces 10 XXXX-XXXX-XXXX-XXXX codes from the unambiguous alphabet', () => {
    const { codes, hashes } = generateRecoveryCodes()
    expect(codes).toHaveLength(10)
    expect(hashes).toHaveLength(10)
    for (const code of codes) {
      expect(code).toMatch(/^[2-9A-HJ-NP-Z]{4}(-[2-9A-HJ-NP-Z]{4}){3}$/)
      expect(code).not.toMatch(/[01OI]/)
    }
  })

  it('produces unique codes, also across many batches', () => {
    const all = new Set<string>()
    for (let i = 0; i < 50; i++) for (const code of generateRecoveryCodes().codes) all.add(code)
    expect(all.size).toBe(500)
  })

  it('stores SHA-256 hex of the normalized code, never the code itself', () => {
    const { codes, hashes } = generateRecoveryCodes(3)
    codes.forEach((code, i) => {
      expect(hashes[i]).toMatch(/^[0-9a-f]{64}$/)
      expect(hashes[i]).toBe(createHash('sha256').update(code.replaceAll('-', '')).digest('hex'))
    })
  })
})

describe('normalizeRecoveryCode', () => {
  it('ignores case, dashes and spaces', () => {
    expect(normalizeRecoveryCode(' abcd-efgh ')).toBe('ABCDEFGH')
    expect(normalizeRecoveryCode('AB CD EF GH')).toBe('ABCDEFGH')
    expect(hashRecoveryCode('abcd efgh')).toBe(hashRecoveryCode('ABCD-EFGH'))
  })
})

describe('findMatchingRecoveryCode', () => {
  const { codes, hashes } = generateRecoveryCodes()

  it('finds the hash of an entered code, in any formatting', () => {
    expect(findMatchingRecoveryCode(codes[3]!, hashes)).toBe(hashes[3])
    expect(findMatchingRecoveryCode(codes[7]!.toLowerCase().replace('-', ' '), hashes)).toBe(hashes[7])
  })

  it('returns null for unknown, empty or already used codes', () => {
    const unknown = 'ZZZZ-ZZZZ'
    expect(codes).not.toContain(unknown)
    expect(findMatchingRecoveryCode(unknown, hashes)).toBeNull()
    expect(findMatchingRecoveryCode('', hashes)).toBeNull()
    expect(findMatchingRecoveryCode(codes[0]!, [])).toBeNull()
    expect(findMatchingRecoveryCode(codes[0]!, hashes.slice(1))).toBeNull()
  })

  it('skips malformed stored values', () => {
    expect(findMatchingRecoveryCode(codes[0]!, ['', 'zz', hashes[0]!])).toBe(hashes[0])
  })
})
