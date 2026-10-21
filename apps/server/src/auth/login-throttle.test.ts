import { describe, expect, it } from 'vitest'
import { checkLoginThrottle, DEFAULT_THROTTLE_POLICY, throttleLookbackMs } from './login-throttle'

const MIN = 60 * 1000
const now = 10_000_000_000

// n failures, one per `gapMs`, the last one `agoMs` before now.
function failures(n: number, agoMs: number, gapMs = 1000): number[] {
  return Array.from({ length: n }, (_, i) => now - agoMs - (n - 1 - i) * gapMs)
}

describe('checkLoginThrottle', () => {
  it('allows when there are no failures', () => {
    expect(checkLoginThrottle({ loginFailures: [], ipFailures: [], now })).toEqual({ allowed: true, retryAfterMs: 0 })
  })

  it('allows 4 failures for a login and locks on the 5th', () => {
    expect(checkLoginThrottle({ loginFailures: failures(4, 0), ipFailures: [], now }).allowed).toBe(true)
    expect(checkLoginThrottle({ loginFailures: failures(5, 0), ipFailures: [], now })).toEqual({ allowed: false, retryAfterMs: 15 * MIN })
  })

  it('counts the lock from the failure that triggered it', () => {
    const decision = checkLoginThrottle({ loginFailures: failures(5, 4 * MIN), ipFailures: [], now })
    expect(decision).toEqual({ allowed: false, retryAfterMs: 11 * MIN })
  })

  it('unlocks exactly when the lock expires', () => {
    expect(checkLoginThrottle({ loginFailures: failures(5, 15 * MIN - 1), ipFailures: [], now })).toEqual({ allowed: false, retryAfterMs: 1 })
    expect(checkLoginThrottle({ loginFailures: failures(5, 15 * MIN), ipFailures: [], now })).toEqual({ allowed: true, retryAfterMs: 0 })
  })

  it('ignores failures spread wider than the 15 minute window', () => {
    // 5 failures, 4 min apart: first and fifth are 16 min apart, so no window holds all five.
    expect(checkLoginThrottle({ loginFailures: failures(5, 0, 4 * MIN), ipFailures: [], now }).allowed).toBe(true)
    // Exactly 15 min between first and fifth: the first one has just left the window.
    expect(checkLoginThrottle({ loginFailures: failures(5, 0, 15 * MIN / 4), ipFailures: [], now }).allowed).toBe(true)
    // A few milliseconds less and all five fit.
    expect(checkLoginThrottle({ loginFailures: failures(5, 0, (15 * MIN - 4) / 4), ipFailures: [], now }).allowed).toBe(false)
  })

  it('locks an IP after 20 failures regardless of login', () => {
    expect(checkLoginThrottle({ loginFailures: [], ipFailures: failures(19, 0), now }).allowed).toBe(true)
    expect(checkLoginThrottle({ loginFailures: [], ipFailures: failures(20, 2 * MIN), now })).toEqual({ allowed: false, retryAfterMs: 13 * MIN })
  })

  it('reports the longer wait when both login and IP are locked', () => {
    const decision = checkLoginThrottle({ loginFailures: failures(5, 10 * MIN), ipFailures: failures(20, 1 * MIN), now })
    expect(decision).toEqual({ allowed: false, retryAfterMs: 14 * MIN })
  })

  it('ignores order and future timestamps', () => {
    const shuffled = failures(5, 0).reverse()
    expect(checkLoginThrottle({ loginFailures: shuffled, ipFailures: [], now }).allowed).toBe(false)
    expect(checkLoginThrottle({ loginFailures: [...failures(4, 0), now + MIN], ipFailures: [], now }).allowed).toBe(true)
  })

  it('keeps a long lock even after the window has passed', () => {
    const policy = { ...DEFAULT_THROTTLE_POLICY, perLogin: { maxFailures: 3, windowMs: 1 * MIN, lockMs: 60 * MIN } }
    const decision = checkLoginThrottle({ loginFailures: failures(3, 30 * MIN), ipFailures: [], now, policy })
    expect(decision).toEqual({ allowed: false, retryAfterMs: 30 * MIN })
    expect(throttleLookbackMs(policy)).toBe(61 * MIN)
  })

  it('needs 30 minutes of history with the default policy', () => {
    expect(throttleLookbackMs()).toBe(30 * MIN)
  })
})
