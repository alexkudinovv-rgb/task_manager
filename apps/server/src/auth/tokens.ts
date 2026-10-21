import { createHash, randomBytes } from 'node:crypto'

const HOUR_MS = 60 * 60 * 1000

export const INVITE_TTL_MS = 72 * HOUR_MS
// Absolute lifetime: a session is never extended by activity, the user logs in again after 30 days.
export const SESSION_TTL_MS = 30 * 24 * HOUR_MS

// 256-bit random token for session cookies and invite links. Only hashToken() output goes to the DB.
export function generateToken(): string {
  return randomBytes(32).toString('base64url')
}

// Tokens are full-entropy random values, so a plain SHA-256 is enough to make a DB leak useless.
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function inviteExpiresAt(now: Date = new Date()): Date {
  return new Date(now.getTime() + INVITE_TTL_MS)
}

export function sessionExpiresAt(now: Date = new Date()): Date {
  return new Date(now.getTime() + SESSION_TTL_MS)
}

export function isExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return now.getTime() >= expiresAt.getTime()
}
