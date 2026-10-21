import { createHash, randomInt, timingSafeEqual } from 'node:crypto'

// No 0/O/1/I so codes survive being read aloud or copied from paper. 32 symbols = 5 bits each.
export const RECOVERY_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
export const RECOVERY_CODE_COUNT = 10
const GROUP_LENGTH = 4
const GROUP_COUNT = 4

function randomGroup(): string {
  let group = ''
  for (let i = 0; i < GROUP_LENGTH; i++) group += RECOVERY_CODE_ALPHABET[randomInt(RECOVERY_CODE_ALPHABET.length)]
  return group
}

export function normalizeRecoveryCode(input: string): string {
  return input.replace(/[\s-]/g, '').toUpperCase()
}

// Codes are random (80 bits each — too many to brute-force from a leaked hash), single-use and only
// replace the second factor (the password is still required), so a fast SHA-256 is fine here,
// unlike for passwords, which need argon2.
export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(normalizeRecoveryCode(code)).digest('hex')
}

// Returns the plain codes (shown to the user once) and their hashes (the only thing stored).
export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): { codes: string[], hashes: string[] } {
  const codes = new Set<string>()
  while (codes.size < count) codes.add(Array.from({ length: GROUP_COUNT }, randomGroup).join('-'))
  const list = [...codes]
  return { codes: list, hashes: list.map(hashRecoveryCode) }
}

// Returns the stored hash that matches (so the caller can delete it), or null.
export function findMatchingRecoveryCode(input: string, storedHashes: readonly string[]): string | null {
  const given = Buffer.from(hashRecoveryCode(input), 'hex')
  let matched: string | null = null
  // Compare against every hash without early exit.
  for (const stored of storedHashes) {
    const candidate = Buffer.from(stored, 'hex')
    if (candidate.length !== given.length) continue
    if (timingSafeEqual(candidate, given) && matched === null) matched = stored
  }
  return matched
}
