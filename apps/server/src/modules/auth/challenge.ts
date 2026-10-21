import { z } from 'zod'
import { decryptSecret, encryptSecret, hashToken } from '../../auth'

// Step-1 → step-2 login token. Stateless: AES-GCM (secret-box) over a tiny JSON payload, so it cannot be
// forged or read without TOTP_ENCRYPTION_KEY. It is bound to the current password hash, so a password
// reset kills challenges issued before it.
export const CHALLENGE_TTL_MS = 5 * 60 * 1000
const PURPOSE = 'login-challenge'

const Payload = z.object({
  p: z.literal(PURPOSE),
  uid: z.string().min(1),
  ph: z.string().min(1),
  exp: z.number(),
})

export function passwordFingerprint(passwordHash: string): string {
  return hashToken(passwordHash).slice(0, 16)
}

export function createChallenge(userId: string, passwordHash: string, key: Buffer, now: number = Date.now()): string {
  const payload: z.infer<typeof Payload> = {
    p: PURPOSE,
    uid: userId,
    ph: passwordFingerprint(passwordHash),
    exp: now + CHALLENGE_TTL_MS,
  }
  return encryptSecret(JSON.stringify(payload), key)
}

/** The user id and password fingerprint, or null for a tampered, foreign or expired challenge. */
export function readChallenge(challenge: string, key: Buffer, now: number = Date.now()): { userId: string, passwordFingerprint: string } | null {
  try {
    const parsed = Payload.safeParse(JSON.parse(decryptSecret(challenge, key)))
    if (!parsed.success || parsed.data.exp <= now) return null
    return { userId: parsed.data.uid, passwordFingerprint: parsed.data.ph }
  } catch {
    return null
  }
}
