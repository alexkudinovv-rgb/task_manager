import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { encryptSecret } from '../../auth'
import { CHALLENGE_TTL_MS, createChallenge, passwordFingerprint, readChallenge } from './challenge'

const key = randomBytes(32)
const now = 1_700_000_000_000

describe('login challenge', () => {
  it('round-trips the user id and password fingerprint', () => {
    const challenge = createChallenge('user-1', 'hash-a', key, now)
    expect(readChallenge(challenge, key, now + 1000)).toEqual({ userId: 'user-1', passwordFingerprint: passwordFingerprint('hash-a') })
  })

  it('expires after five minutes', () => {
    const challenge = createChallenge('user-1', 'hash-a', key, now)
    expect(readChallenge(challenge, key, now + CHALLENGE_TTL_MS - 1)).not.toBeNull()
    expect(readChallenge(challenge, key, now + CHALLENGE_TTL_MS)).toBeNull()
  })

  it('rejects another key, tampering and foreign blobs', () => {
    const challenge = createChallenge('user-1', 'hash-a', key, now)
    expect(readChallenge(challenge, randomBytes(32), now)).toBeNull()
    // Flip the first character of the ciphertext (fully significant bits, unlike the last one).
    const parts = challenge.split(':')
    parts[3] = (parts[3]!.startsWith('A') ? 'B' : 'A') + parts[3]!.slice(1)
    const tampered = parts.join(':')
    expect(readChallenge(tampered, key, now)).toBeNull()
    expect(readChallenge('garbage', key, now)).toBeNull()
    // A TOTP secret encrypted with the same key is not a challenge.
    expect(readChallenge(encryptSecret('JBSWY3DPEHPK3PXP', key), key, now)).toBeNull()
    expect(readChallenge(encryptSecret(JSON.stringify({ uid: 'x', exp: now + 1000 }), key), key, now)).toBeNull()
  })

  it('fingerprints differ per password hash', () => {
    expect(passwordFingerprint('hash-a')).not.toBe(passwordFingerprint('hash-b'))
  })
})
