import type { CreateUserResponse, DirectoryResponse, InviteLinkResponse, Role, UserDto } from '@car-city/shared/model'
import { and, asc, eq, gt, isNull, lt, or, sql, type SQL } from 'drizzle-orm'
import { z } from 'zod'
import {
  checkLoginThrottle,
  findMatchingRecoveryCode,
  generateToken,
  hashToken,
  inviteExpiresAt,
  sessionExpiresAt,
  throttleLookbackMs,
  verifyTotp,
  type ThrottleDecision,
} from '../../auth'
import type { Db } from '../../db/client'
import { invites, loginAttempts, positions, recoveryCodes, sessions, units, users, type Invite, type User } from '../../db/schema'
import { apiError } from '../../http/errors'

/** A drizzle transaction handle (same query API as Db). */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
type Executor = Db | Tx

const UNIQUE_VIOLATION = '23505'

export class OwnerExistsError extends Error {
  constructor() {
    super('Собственник уже создан')
  }
}

/** The only place where a users row becomes a UserDto. */
export function toUserDto(row: User): UserDto {
  return {
    id: row.id,
    login: row.login,
    firstName: row.firstName,
    lastName: row.lastName,
    role: row.role,
    positionId: row.positionId,
    unitId: row.unitId,
    isAdmin: row.isAdmin,
    disabled: row.disabledAt !== null,
  }
}

export function buildInviteUrl(publicUrl: string, token: string): string {
  return `${publicUrl.replace(/\/+$/, '')}/invite/${token}`
}

// drizzle wraps driver errors in DrizzleQueryError with the pg error as `cause`.
function pgError(error: unknown): { code?: string, constraint?: string } {
  const e = error as { code?: string, constraint?: string, cause?: { code?: string, constraint?: string } } | null
  if (e?.cause?.code) return e.cause
  return e ?? {}
}

const Uuid = z.uuid()
export function isUuid(value: string): boolean {
  return Uuid.safeParse(value).success
}

// ---------- lookups ----------

export async function findUserById(db: Executor, id: string): Promise<User | undefined> {
  if (!isUuid(id)) return undefined
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1)
  return row
}

export async function findUserByLogin(db: Executor, login: string): Promise<User | undefined> {
  const [row] = await db.select().from(users).where(eq(users.login, login)).limit(1)
  return row
}

export async function findOwner(db: Executor): Promise<User | undefined> {
  const [row] = await db.select().from(users).where(eq(users.role, 'owner')).limit(1)
  return row
}

/** Rejects unknown position/unit ids with 400 instead of a foreign-key 500. */
export async function assertReferences(db: Executor, refs: { positionId?: string | null, unitId?: string | null }): Promise<void> {
  if (refs.positionId != null) {
    const ok = isUuid(refs.positionId)
      && (await db.select({ id: positions.id }).from(positions).where(eq(positions.id, refs.positionId)).limit(1)).length > 0
    if (!ok) throw apiError(400, 'validation', { message: 'Такой должности нет' })
  }
  if (refs.unitId != null) {
    const ok = isUuid(refs.unitId)
      && (await db.select({ id: units.id }).from(units).where(eq(units.id, refs.unitId)).limit(1)).length > 0
    if (!ok) throw apiError(400, 'validation', { message: 'Такого подразделения нет' })
  }
}

/**
 * Users (active first, then by name), positions and units. Disabled users are included for every
 * viewer, flagged `disabled: true`: old tasks still reference them and must show their names.
 */
export async function loadDirectory(db: Executor): Promise<DirectoryResponse> {
  const [userRows, positionRows, unitRows] = await Promise.all([
    db.select().from(users).orderBy(sql`${users.disabledAt} IS NOT NULL`, asc(users.lastName), asc(users.firstName)),
    db.select({ id: positions.id, name: positions.name }).from(positions).orderBy(asc(positions.sort), asc(positions.name)),
    db.select({ id: units.id, name: units.name }).from(units).orderBy(asc(units.sort), asc(units.name)),
  ])
  return { users: userRows.map(toUserDto), positions: positionRows, units: unitRows }
}

// ---------- users & invites ----------

export interface NewUserInput {
  login: string
  firstName: string
  lastName: string
  positionId?: string | null
  unitId?: string | null
  isAdmin?: boolean
  role?: Role
}

interface InviteOptions {
  createdBy: string | null
  publicUrl: string
  now?: Date
}

// Unused invites of the user are dropped: only the newest link works.
async function issueInvite(tx: Executor, userId: string, options: InviteOptions): Promise<InviteLinkResponse> {
  await tx.delete(invites).where(and(eq(invites.userId, userId), isNull(invites.usedAt)))
  const token = generateToken()
  const expiresAt = inviteExpiresAt(options.now)
  await tx.insert(invites).values({ userId, tokenHash: hashToken(token), expiresAt, createdBy: options.createdBy })
  return { inviteUrl: buildInviteUrl(options.publicUrl, token), expiresAt: expiresAt.toISOString() }
}

/** Creates a user without credentials plus an invite link. 409 login_taken; OwnerExistsError for a second owner. */
export async function createUserWithInvite(db: Db, input: NewUserInput, options: InviteOptions): Promise<CreateUserResponse> {
  const role = input.role ?? 'director'
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(users)
        .values({
          login: input.login,
          firstName: input.firstName,
          lastName: input.lastName,
          role,
          positionId: input.positionId ?? null,
          unitId: input.unitId ?? null,
          // The owner is always an admin (also a DB CHECK).
          isAdmin: role === 'owner' || (input.isAdmin ?? false),
        })
        .returning()
      const link = await issueInvite(tx, row!.id, options)
      return { user: toUserDto(row!), ...link }
    })
  } catch (error) {
    const { code, constraint } = pgError(error)
    if (code === UNIQUE_VIOLATION && constraint === 'users_login_unique') {
      throw apiError(409, 'login_taken', { message: 'Такой логин уже занят' })
    }
    if (code === UNIQUE_VIOLATION && constraint === 'users_single_owner') throw new OwnerExistsError()
    throw error
  }
}

/**
 * Password + 2FA reset: clears password, TOTP and recovery codes, ends sessions and issues a fresh
 * invite (previous unused invites stop working). Undefined when the user does not exist.
 */
export async function resetAccessAndInvite(db: Db, userId: string, options: InviteOptions): Promise<InviteLinkResponse | undefined> {
  if (!isUuid(userId)) return undefined
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(users)
      .set({ passwordHash: null, totpSecretEnc: null, totpEnabled: false, totpLastStep: null })
      .where(eq(users.id, userId))
      .returning({ id: users.id })
    if (!row) return undefined
    await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId))
    await tx.delete(sessions).where(eq(sessions.userId, userId))
    return issueInvite(tx, userId, options)
  })
}

/** For the create-owner CLI. Throws OwnerExistsError when an owner is already there. */
export async function createOwner(
  db: Db,
  input: { login: string, firstName: string, lastName: string },
  publicUrl: string,
): Promise<CreateUserResponse> {
  if (await findOwner(db)) throw new OwnerExistsError()
  return createUserWithInvite(db, { ...input, role: 'owner', isAdmin: true }, { createdBy: null, publicUrl })
}

/** For `create-owner --reset`: a fresh invite for the existing owner (same semantics as the admin reset). */
export async function resetOwner(db: Db, publicUrl: string): Promise<{ owner: UserDto, link: InviteLinkResponse } | undefined> {
  const owner = await findOwner(db)
  if (!owner) return undefined
  const link = await resetAccessAndInvite(db, owner.id, { createdBy: null, publicUrl })
  return link && { owner: toUserDto(owner), link }
}

/** An unused, unexpired invite of an active user who has not finished onboarding. */
export async function findOpenInvite(db: Executor, token: string, now: Date): Promise<{ invite: Invite, user: User } | undefined> {
  const [row] = await db
    .select({ invite: invites, user: users })
    .from(invites)
    .innerJoin(users, eq(users.id, invites.userId))
    .where(and(
      eq(invites.tokenHash, hashToken(token)),
      isNull(invites.usedAt),
      gt(invites.expiresAt, now),
      isNull(users.disabledAt),
      eq(users.totpEnabled, false),
    ))
    .limit(1)
  return row
}

/**
 * Admin rows locked FOR UPDATE in id order. Taking this lock before touching a target user
 * serialises concurrent demote/disable requests, so two admins cannot remove each other at once.
 */
export async function lockActiveAdmins(tx: Tx): Promise<{ id: string }[]> {
  return tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.isAdmin, true), isNull(users.disabledAt)))
    .orderBy(asc(users.id))
    .for('update')
}

// ---------- sessions & login attempts ----------

export interface ClientMeta {
  userAgent?: string | null
  ip?: string | null
}

/** Returns the raw cookie token; only its hash is stored. */
export async function createSession(db: Executor, userId: string, meta: ClientMeta, now: Date = new Date()): Promise<string> {
  const token = generateToken()
  await db.insert(sessions).values({
    userId,
    tokenHash: hashToken(token),
    createdAt: now,
    lastSeenAt: now,
    expiresAt: sessionExpiresAt(now),
    userAgent: meta.userAgent ? meta.userAgent.slice(0, 512) : null,
    ip: meta.ip ?? null,
  })
  return token
}

export async function loginThrottle(db: Executor, login: string, ip: string | null, now: number): Promise<ThrottleDecision> {
  const since = new Date(now - throttleLookbackMs())
  const failures = async (subject: SQL) => {
    const rows = await db
      .select({ at: loginAttempts.at })
      .from(loginAttempts)
      .where(and(subject, eq(loginAttempts.success, false), gt(loginAttempts.at, since)))
    return rows.map((row) => row.at.getTime())
  }
  const [loginFailures, ipFailures] = await Promise.all([
    failures(eq(loginAttempts.login, login)),
    ip ? failures(eq(loginAttempts.ip, ip)) : Promise.resolve([]),
  ])
  return checkLoginThrottle({ loginFailures, ipFailures, now })
}

export async function recordLoginAttempt(db: Executor, login: string, ip: string | null, success: boolean, now: number): Promise<void> {
  await db.insert(loginAttempts).values({ login, ip, success, at: new Date(now) })
}

/**
 * Checks a TOTP code (rejecting replays via totp_last_step) or consumes a recovery code.
 * Both writes are conditional, so two parallel requests cannot use the same code.
 */
export async function verifySecondFactor(
  db: Executor,
  user: User,
  secret: string | null,
  input: { code?: string, recoveryCode?: string },
  now: number,
): Promise<boolean> {
  if (input.code) {
    if (!secret) return false
    const step = verifyTotp(secret, input.code, now, { lastUsedStep: user.totpLastStep })
    if (step === null) return false
    const updated = await db
      .update(users)
      .set({ totpLastStep: step })
      .where(and(eq(users.id, user.id), or(isNull(users.totpLastStep), lt(users.totpLastStep, step))))
      .returning({ id: users.id })
    return updated.length === 1
  }
  if (input.recoveryCode) {
    const rows = await db
      .select({ codeHash: recoveryCodes.codeHash })
      .from(recoveryCodes)
      .where(and(eq(recoveryCodes.userId, user.id), isNull(recoveryCodes.usedAt)))
    const match = findMatchingRecoveryCode(input.recoveryCode, rows.map((row) => row.codeHash))
    if (!match) return false
    const deleted = await db
      .delete(recoveryCodes)
      .where(and(eq(recoveryCodes.userId, user.id), eq(recoveryCodes.codeHash, match)))
      .returning({ id: recoveryCodes.id })
    return deleted.length > 0
  }
  return false
}
