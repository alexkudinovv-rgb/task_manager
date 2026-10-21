const MINUTE_MS = 60 * 1000

export interface ThrottleRule {
  maxFailures: number
  windowMs: number
  lockMs: number
}

export interface ThrottlePolicy {
  perLogin: ThrottleRule
  perIp: ThrottleRule
}

export const DEFAULT_THROTTLE_POLICY: ThrottlePolicy = {
  // A wrong password still needs the TOTP code after it, so the limit can be lenient for people.
  perLogin: { maxFailures: 10, windowMs: 15 * MINUTE_MS, lockMs: 5 * MINUTE_MS },
  perIp: { maxFailures: 30, windowMs: 15 * MINUTE_MS, lockMs: 5 * MINUTE_MS },
}

// How far back callers must load failures so that checkLoginThrottle sees every lock still in force.
export function throttleLookbackMs(policy: ThrottlePolicy = DEFAULT_THROTTLE_POLICY): number {
  return Math.max(policy.perLogin.windowMs + policy.perLogin.lockMs, policy.perIp.windowMs + policy.perIp.lockMs)
}

export interface ThrottleDecision {
  allowed: boolean
  retryAfterMs: number
}

// Time until which the rule keeps the subject locked, or 0. A lock starts at the failure that brought
// the count within one window to maxFailures and lasts lockMs from that failure.
function lockedUntil(failures: readonly number[], rule: ThrottleRule, now: number): number {
  const sorted = failures.filter((t) => t <= now).sort((a, b) => a - b)
  let until = 0
  let start = 0
  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i]!
    while (sorted[start]! <= t - rule.windowMs) start++
    if (i - start + 1 >= rule.maxFailures) until = Math.max(until, t + rule.lockMs)
  }
  return until
}

// Pure policy over failure timestamps (ms). Callers record only real credential failures, not attempts
// rejected by this throttle, otherwise a locked-out attacker would keep extending the lock.
export function checkLoginThrottle(input: {
  loginFailures: readonly number[]
  ipFailures: readonly number[]
  now: number
  policy?: ThrottlePolicy
}): ThrottleDecision {
  const policy = input.policy ?? DEFAULT_THROTTLE_POLICY
  const until = Math.max(
    lockedUntil(input.loginFailures, policy.perLogin, input.now),
    lockedUntil(input.ipFailures, policy.perIp, input.now),
  )
  const retryAfterMs = Math.max(0, until - input.now)
  return { allowed: retryAfterMs === 0, retryAfterMs }
}
