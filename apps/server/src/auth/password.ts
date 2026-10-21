import { hash, verify } from '@node-rs/argon2'

// argon2id (the library default algorithm) with the OWASP-recommended baseline parameters.
const ARGON2_OPTIONS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
}

export const PASSWORD_MIN_LENGTH = 10
// Upper bound only to keep hashing cost predictable for absurd inputs.
export const PASSWORD_MAX_LENGTH = 256

export type PasswordProblem = 'too_short' | 'too_long' | 'equals_login'

export const PASSWORD_PROBLEM_MESSAGES: Record<PasswordProblem, string> = {
  too_short: `Пароль должен быть не короче ${PASSWORD_MIN_LENGTH} символов`,
  too_long: `Пароль должен быть не длиннее ${PASSWORD_MAX_LENGTH} символов`,
  equals_login: 'Пароль не должен совпадать с логином',
}

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, ARGON2_OPTIONS)
}

export async function verifyPassword(passwordHash: string, plain: string): Promise<boolean> {
  try {
    return await verify(passwordHash, plain)
  } catch {
    // Malformed or foreign hash string: treat as a mismatch, never as a crash.
    return false
  }
}

let dummyHash: Promise<string> | undefined

// Runs a full verification against a throwaway hash, so that "unknown login"
// takes as long as "wrong password" and timing does not reveal which logins exist.
export async function verifyPasswordDummy(plain: string): Promise<false> {
  dummyHash ??= hashPassword('dummy-password-for-timing-equalisation')
  await verifyPassword(await dummyHash, plain)
  return false
}

export function validatePasswordPolicy(plain: string, options: { login?: string } = {}): PasswordProblem[] {
  const problems: PasswordProblem[] = []
  const length = [...plain].length
  if (length < PASSWORD_MIN_LENGTH) problems.push('too_short')
  if (length > PASSWORD_MAX_LENGTH) problems.push('too_long')
  const login = options.login?.trim().toLowerCase()
  if (login && plain.trim().toLowerCase() === login) problems.push('equals_login')
  return problems
}
