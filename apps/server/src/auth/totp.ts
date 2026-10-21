import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

// RFC 6238 TOTP with the parameters every authenticator app supports.
export const TOTP_STEP_SECONDS = 30
export const TOTP_DIGITS = 6
export const TOTP_ISSUER = 'Car City Задачи'

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Encode(data: Uint8Array): string {
  let out = ''
  let buffer = 0
  let bits = 0
  for (const byte of data) {
    buffer = (buffer << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += BASE32_ALPHABET[(buffer >>> (bits - 5)) & 31]
      bits -= 5
    }
    buffer &= (1 << bits) - 1
  }
  if (bits > 0) out += BASE32_ALPHABET[(buffer << (5 - bits)) & 31]
  return out
}

// Lenient about case, spaces and padding (users sometimes type secrets by hand), strict about the alphabet.
export function base32Decode(input: string): Buffer {
  const clean = input.replace(/[\s=]/g, '').toUpperCase()
  const bytes: number[] = []
  let buffer = 0
  let bits = 0
  for (const char of clean) {
    const value = BASE32_ALPHABET.indexOf(char)
    if (value === -1) throw new Error('Invalid base32 character')
    buffer = (buffer << 5) | value
    bits += 5
    if (bits >= 8) {
      bytes.push((buffer >>> (bits - 8)) & 0xff)
      bits -= 8
    }
    buffer &= (1 << bits) - 1
  }
  return Buffer.from(bytes)
}

// 160-bit secret, the size RFC 4226 recommends for HMAC-SHA1.
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20))
}

export interface TotpOptions {
  digits?: number
  stepSeconds?: number
}

export function totpStep(timeMs: number, stepSeconds = TOTP_STEP_SECONDS): number {
  return Math.floor(timeMs / 1000 / stepSeconds)
}

function hotp(key: Buffer, counter: number, digits: number): string {
  const message = Buffer.alloc(8)
  message.writeBigUInt64BE(BigInt(counter))
  const mac = createHmac('sha1', key).update(message).digest()
  const offset = mac[mac.length - 1]! & 0x0f
  const binary = mac.readUInt32BE(offset) & 0x7fffffff
  return String(binary % 10 ** digits).padStart(digits, '0')
}

export function totpCode(secret: string, timeMs: number, options: TotpOptions = {}): string {
  const { digits = TOTP_DIGITS, stepSeconds = TOTP_STEP_SECONDS } = options
  return hotp(base32Decode(secret), totpStep(timeMs, stepSeconds), digits)
}

export interface VerifyTotpOptions extends TotpOptions {
  // How many steps before/after the current one are accepted (clock drift).
  window?: number
  // Step of the last successfully used code; codes from that step or earlier are replays.
  lastUsedStep?: number | null
}

// Returns the matched time step (store it as lastUsedStep), or null when the code is not accepted.
export function verifyTotp(secret: string, code: string, timeMs: number, options: VerifyTotpOptions = {}): number | null {
  const { digits = TOTP_DIGITS, stepSeconds = TOTP_STEP_SECONDS, window = 1, lastUsedStep = null } = options
  const candidate = code.replace(/\s/g, '')
  if (!new RegExp(`^\\d{${digits}}$`).test(candidate)) return null

  const key = base32Decode(secret)
  const given = Buffer.from(candidate)
  const current = totpStep(timeMs, stepSeconds)
  let matched: number | null = null
  // Every step in the window is checked, no early exit, so timing does not depend on which one matched.
  for (let step = current - window; step <= current + window; step++) {
    if (step < 0) continue
    const expected = Buffer.from(hotp(key, step, digits))
    const equal = timingSafeEqual(expected, given)
    if (equal && (lastUsedStep === null || step > lastUsedStep) && matched === null) matched = step
  }
  return matched
}

export function otpauthUri(params: { secret: string, account: string, issuer?: string }): string {
  const issuer = params.issuer ?? TOTP_ISSUER
  // encodeURIComponent (not URLSearchParams) so spaces become %20: some apps show a literal "+".
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(params.account)}`
  const query = [
    `secret=${encodeURIComponent(params.secret)}`,
    `issuer=${encodeURIComponent(issuer)}`,
    'algorithm=SHA1',
    `digits=${TOTP_DIGITS}`,
    `period=${TOTP_STEP_SECONDS}`,
  ].join('&')
  return `otpauth://totp/${label}?${query}`
}
