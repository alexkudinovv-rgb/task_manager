import { describe, expect, it } from 'vitest'
import { checkLoginThrottle, DEFAULT_THROTTLE_POLICY, throttleLookbackMs } from './login-throttle'

const MIN = 60 * 1000
const now = 10_000_000_000
// Numbers come from the policy so the limits can be tuned without rewriting the tests.
const LOGIN = DEFAULT_THROTTLE_POLICY.perLogin
const IP = DEFAULT_THROTTLE_POLICY.perIp

// n failures, one per `gapMs`, the last one `agoMs` before now.
function failures(n: number, agoMs: number, gapMs = 1000): number[] {
  return Array.from({ length: n }, (_, i) => now - agoMs - (n - 1 - i) * gapMs)
}

describe('default policy', () => {
  it('is 10 failures per login and 30 per IP within 15 minutes, locking for 5 minutes', () => {
    expect(LOGIN).toEqual({ maxFailures: 10, windowMs: 15 * MIN, lockMs: 5 * MIN })
    expect(IP).toEqual({ maxFailures: 30, windowMs: 15 * MIN, lockMs: 5 * MIN })
  })
})

describe('checkLoginThrottle', () => {
  it('allows when there are no failures', () => {
    expect(checkLoginThrottle({ loginFailures: [], ipFailures: [], now })).toEqual({ allowed: true, retryAfterMs: 0 })
  })

  it('allows one below the limit for a login and locks on reaching it', () => {
    expect(checkLoginThrottle({ loginFailures: failures(LOGIN.maxFailures - 1, 0), ipFailures: [], now }).allowed).toBe(true)
    expect(checkLoginThrottle({ loginFailures: failures(LOGIN.maxFailures, 0), ipFailures: [], now })).toEqual({
      allowed: false,
      retryAfterMs: LOGIN.lockMs,
    })
  })

  it('counts the lock from the failure that triggered it', () => {
    const decision = checkLoginThrottle({ loginFailures: failures(LOGIN.maxFailures, 2 * MIN), ipFailures: [], now })
    expect(decision).toEqual({ allowed: false, retryAfterMs: LOGIN.lockMs - 2 * MIN })
  })

  it('unlocks exactly when the lock expires', () => {
    expect(checkLoginThrottle({ loginFailures: failures(LOGIN.maxFailures, LOGIN.lockMs - 1), ipFailures: [], now })).toEqual({
      allowed: false,
      retryAfterMs: 1,
    })
    expect(checkLoginThrottle({ loginFailures: failures(LOGIN.maxFailures, LOGIN.lockMs), ipFailures: [], now })).toEqual({
      allowed: true,
      retryAfterMs: 0,
    })
  })

  it('ignores failures spread wider than the window', () => {
    const n = LOGIN.maxFailures
    // Exactly one window between first and last: the first one has just left it.
    expect(checkLoginThrottle({ loginFailures: failures(n, 0, LOGIN.windowMs / (n - 1)), ipFailures: [], now }).allowed).toBe(true)
    // A few milliseconds less and all of them fit.
    expect(checkLoginThrottle({ loginFailures: failures(n, 0, (LOGIN.windowMs - n) / (n - 1)), ipFailures: [], now }).allowed).toBe(false)
  })

  it('locks an IP after its limit regardless of login', () => {
    expect(checkLoginThrottle({ loginFailures: [], ipFailures: failures(IP.maxFailures - 1, 0), now }).allowed).toBe(true)
    expect(checkLoginThrottle({ loginFailures: [], ipFailures: failures(IP.maxFailures, 1 * MIN), now })).toEqual({
      allowed: false,
      retryAfterMs: IP.lockMs - 1 * MIN,
    })
  })

  it('reports the longer wait when both login and IP are locked', () => {
    const decision = checkLoginThrottle({
      loginFailures: failures(LOGIN.maxFailures, 3 * MIN),
      ipFailures: failures(IP.maxFailures, 1 * MIN),
      now,
    })
    expect(decision).toEqual({ allowed: false, retryAfterMs: Math.max(LOGIN.lockMs - 3 * MIN, IP.lockMs - 1 * MIN) })
  })

  it('ignores order and future timestamps', () => {
    const shuffled = failures(LOGIN.maxFailures, 0).reverse()
    expect(checkLoginThrottle({ loginFailures: shuffled, ipFailures: [], now }).allowed).toBe(false)
    expect(checkLoginThrottle({ loginFailures: [...failures(LOGIN.maxFailures - 1, 0), now + MIN], ipFailures: [], now }).allowed).toBe(true)
  })

  it('keeps a long lock even after the window has passed', () => {
    const policy = { ...DEFAULT_THROTTLE_POLICY, perLogin: { maxFailures: 3, windowMs: 1 * MIN, lockMs: 60 * MIN } }
    const decision = checkLoginThrottle({ loginFailures: failures(3, 30 * MIN), ipFailures: [], now, policy })
    expect(decision).toEqual({ allowed: false, retryAfterMs: 30 * MIN })
    expect(throttleLookbackMs(policy)).toBe(61 * MIN)
  })

  it('loads window + lock of history with the default policy', () => {
    expect(throttleLookbackMs()).toBe(Math.max(LOGIN.windowMs + LOGIN.lockMs, IP.windowMs + IP.lockMs))
  })
})
