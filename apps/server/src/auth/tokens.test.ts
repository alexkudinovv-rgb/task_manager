import { describe, expect, it } from 'vitest'
import { generateToken, hashToken, INVITE_TTL_MS, inviteExpiresAt, isExpired, SESSION_TTL_MS, sessionExpiresAt } from './tokens'

describe('generateToken', () => {
  it('returns 32 random bytes as base64url without padding', () => {
    const token = generateToken()
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(Buffer.from(token, 'base64url')).toHaveLength(32)
  })

  it('never repeats', () => {
    const tokens = new Set(Array.from({ length: 1000 }, generateToken))
    expect(tokens.size).toBe(1000)
  })
})

describe('hashToken', () => {
  it('is deterministic SHA-256 hex and differs from the token', () => {
    const token = generateToken()
    expect(hashToken(token)).toBe(hashToken(token))
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/)
    expect(hashToken(token)).not.toBe(hashToken(generateToken()))
    expect(hashToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})

describe('expiry', () => {
  const now = new Date('2026-10-20T10:00:00Z')

  it('uses 72 h for invites and 30 days for sessions', () => {
    expect(INVITE_TTL_MS).toBe(72 * 3600 * 1000)
    expect(SESSION_TTL_MS).toBe(30 * 24 * 3600 * 1000)
    expect(inviteExpiresAt(now).toISOString()).toBe('2026-10-23T10:00:00.000Z')
    expect(sessionExpiresAt(now).toISOString()).toBe('2026-11-19T10:00:00.000Z')
  })

  it('treats the expiry instant itself as expired', () => {
    const expiresAt = sessionExpiresAt(now)
    expect(isExpired(expiresAt, new Date(expiresAt.getTime() - 1))).toBe(false)
    expect(isExpired(expiresAt, expiresAt)).toBe(true)
    expect(isExpired(expiresAt, new Date(expiresAt.getTime() + 1))).toBe(true)
  })
})
