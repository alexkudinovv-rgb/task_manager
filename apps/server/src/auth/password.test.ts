import { describe, expect, it } from 'vitest'
import { hashPassword, validatePasswordPolicy, verifyPassword, verifyPasswordDummy } from './password'

describe('password hashing', () => {
  it('hashes with argon2id and verifies the right password only', async () => {
    const hash = await hashPassword('correct horse battery')
    expect(hash.startsWith('$argon2id$v=19$m=19456,t=2,p=1$')).toBe(true)
    expect(await verifyPassword(hash, 'correct horse battery')).toBe(true)
    expect(await verifyPassword(hash, 'correct horse batterY')).toBe(false)
    expect(await verifyPassword(hash, '')).toBe(false)
  })

  it('salts every hash', async () => {
    expect(await hashPassword('same-password')).not.toBe(await hashPassword('same-password'))
  })

  it('treats a malformed hash as a mismatch', async () => {
    expect(await verifyPassword('not-a-hash', 'whatever')).toBe(false)
  })

  it('dummy verification always fails', async () => {
    expect(await verifyPasswordDummy('dummy-password-for-timing-equalisation')).toBe(false)
  })
})

describe('validatePasswordPolicy', () => {
  it('accepts a long enough password', () => {
    expect(validatePasswordPolicy('0123456789')).toEqual([])
  })

  it('rejects passwords shorter than 10 characters', () => {
    expect(validatePasswordPolicy('012345678')).toEqual(['too_short'])
    expect(validatePasswordPolicy('')).toEqual(['too_short'])
  })

  it('counts characters, not UTF-16 units', () => {
    expect(validatePasswordPolicy('пароль😀😀😀😀')).toEqual([])
    expect(validatePasswordPolicy('😀😀😀😀😀')).toEqual(['too_short'])
  })

  it('rejects absurdly long passwords', () => {
    expect(validatePasswordPolicy('a'.repeat(257))).toEqual(['too_long'])
    expect(validatePasswordPolicy('a'.repeat(256))).toEqual([])
  })

  it('rejects a password equal to the login, ignoring case', () => {
    expect(validatePasswordPolicy('Ivan.Petrov', { login: 'ivan.petrov' })).toEqual(['equals_login'])
    expect(validatePasswordPolicy('ivan.petrov', { login: 'ivan.petrov' })).toEqual(['equals_login'])
    expect(validatePasswordPolicy('ivan.petrov-2024', { login: 'ivan.petrov' })).toEqual([])
  })

  it('reports several problems at once', () => {
    expect(validatePasswordPolicy('ivan', { login: 'ivan' })).toEqual(['too_short', 'equals_login'])
  })
})
