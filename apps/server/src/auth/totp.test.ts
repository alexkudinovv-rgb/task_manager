import { describe, expect, it } from 'vitest'
import { base32Decode, base32Encode, generateTotpSecret, otpauthUri, totpCode, totpStep, verifyTotp } from './totp'

// RFC 6238 Appendix B uses the ASCII seed "12345678901234567890" for SHA-1.
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890', 'ascii'))

describe('base32', () => {
  it('encodes the RFC seed as expected', () => {
    expect(RFC_SECRET).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ')
  })

  it('matches RFC 4648 test vectors (without padding)', () => {
    const vectors: [string, string][] = [
      ['', ''], ['f', 'MY'], ['fo', 'MZXQ'], ['foo', 'MZXW6'],
      ['foob', 'MZXW6YQ'], ['fooba', 'MZXW6YTB'], ['foobar', 'MZXW6YTBOI'],
    ]
    for (const [plain, encoded] of vectors) {
      expect(base32Encode(Buffer.from(plain))).toBe(encoded)
      expect(base32Decode(encoded).toString()).toBe(plain)
    }
  })

  it('round-trips random bytes and tolerates case, spaces and padding', () => {
    for (let length = 0; length < 40; length++) {
      const bytes = Buffer.from(Array.from({ length }, (_, i) => (i * 37 + length) & 0xff))
      expect(base32Decode(base32Encode(bytes)).equals(bytes)).toBe(true)
    }
    expect(base32Decode('mzxw 6ytb oi======').toString()).toBe('foobar')
  })

  it('rejects characters outside the alphabet', () => {
    expect(() => base32Decode('MZXW1')).toThrow()
  })
})

describe('generateTotpSecret', () => {
  it('produces 20 random bytes as unpadded base32', () => {
    const secret = generateTotpSecret()
    expect(secret).toMatch(/^[A-Z2-7]{32}$/)
    expect(base32Decode(secret)).toHaveLength(20)
    expect(generateTotpSecret()).not.toBe(secret)
  })
})

describe('totpCode', () => {
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ])('matches RFC 6238 vector at T=%i', (seconds, expected) => {
    expect(totpCode(RFC_SECRET, seconds * 1000, { digits: 8 })).toBe(expected)
  })

  it('defaults to 6 digits', () => {
    expect(totpCode(RFC_SECRET, 59_000)).toBe('287082')
  })
})

describe('verifyTotp', () => {
  // Middle of a step, so +-30 s lands exactly one step away.
  const now = 1_700_000_015_000
  const step = totpStep(now)
  const codeAt = (offsetSteps: number) => totpCode(RFC_SECRET, now + offsetSteps * 30_000)

  it('accepts the current code and returns its step', () => {
    expect(verifyTotp(RFC_SECRET, codeAt(0), now)).toBe(step)
  })

  it('accepts codes one step off (clock drift) and rejects two steps off', () => {
    expect(verifyTotp(RFC_SECRET, codeAt(-1), now)).toBe(step - 1)
    expect(verifyTotp(RFC_SECRET, codeAt(1), now)).toBe(step + 1)
    expect(verifyTotp(RFC_SECRET, codeAt(-2), now)).toBeNull()
    expect(verifyTotp(RFC_SECRET, codeAt(2), now)).toBeNull()
  })

  it('honours a custom window', () => {
    expect(verifyTotp(RFC_SECRET, codeAt(-1), now, { window: 0 })).toBeNull()
    expect(verifyTotp(RFC_SECRET, codeAt(-2), now, { window: 2 })).toBe(step - 2)
  })

  it('rejects replay of the same or an earlier step', () => {
    const used = verifyTotp(RFC_SECRET, codeAt(0), now)
    expect(used).toBe(step)
    expect(verifyTotp(RFC_SECRET, codeAt(0), now, { lastUsedStep: used })).toBeNull()
    expect(verifyTotp(RFC_SECRET, codeAt(-1), now, { lastUsedStep: used })).toBeNull()
    // The next code is still fine.
    expect(verifyTotp(RFC_SECRET, codeAt(1), now, { lastUsedStep: used })).toBe(step + 1)
  })

  it('rejects malformed and wrong codes', () => {
    expect(verifyTotp(RFC_SECRET, '', now)).toBeNull()
    expect(verifyTotp(RFC_SECRET, '12345', now)).toBeNull()
    expect(verifyTotp(RFC_SECRET, '1234567', now)).toBeNull()
    expect(verifyTotp(RFC_SECRET, 'abcdef', now)).toBeNull()
    const wrong = String((Number(codeAt(0)) + 1) % 1_000_000).padStart(6, '0')
    expect(verifyTotp(RFC_SECRET, wrong, now)).toBeNull()
  })

  it('ignores spaces inside the code', () => {
    const code = codeAt(0)
    expect(verifyTotp(RFC_SECRET, `${code.slice(0, 3)} ${code.slice(3)}`, now)).toBe(step)
  })
})

describe('otpauthUri', () => {
  it('builds an encoded otpauth URI with the default issuer', () => {
    const uri = otpauthUri({ secret: 'JBSWY3DPEHPK3PXP', account: 'иван петров' })
    const issuer = encodeURIComponent('Car City Задачи')
    expect(uri).toBe(
      `otpauth://totp/${issuer}:${encodeURIComponent('иван петров')}`
      + `?secret=JBSWY3DPEHPK3PXP&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`,
    )
    expect(uri).not.toContain(' ')
    expect(uri).not.toContain('+')
  })

  it('escapes characters that would break the label', () => {
    const uri = otpauthUri({ secret: 'ABC', account: 'a:b?c&d', issuer: 'X' })
    expect(uri.startsWith('otpauth://totp/X:a%3Ab%3Fc%26d?')).toBe(true)
  })
})
