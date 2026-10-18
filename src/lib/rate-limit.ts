// Tiny in-memory token bucket for abuse-sensitive endpoints (currently login).
// Single-process by design: it bounds casual online guessing on a deployment
// like this one. A multi-instance deployment must replace it with a shared
// store (e.g. Redis); the call sites only depend on the small interface below.

export interface RateLimitOptions {
  maxAttempts: number;
  windowMs: number;
}

export interface RateLimitVerdict {
  limited: boolean;
  /** Seconds until the window resets. 0 when not limited. */
  retryAfterSeconds: number;
}

export function createRateLimiter({ maxAttempts, windowMs }: RateLimitOptions) {
  const attempts = new Map<string, { count: number; firstAt: number }>();

  function prune(now: number) {
    if (attempts.size <= 1000) return;
    for (const [k, v] of attempts) {
      if (now - v.firstAt > windowMs) attempts.delete(k);
    }
  }

  return {
    check(key: string, now: number = Date.now()): RateLimitVerdict {
      const entry = attempts.get(key);
      if (!entry) return { limited: false, retryAfterSeconds: 0 };
      if (now - entry.firstAt > windowMs) {
        attempts.delete(key);
        return { limited: false, retryAfterSeconds: 0 };
      }
      if (entry.count >= maxAttempts) {
        return {
          limited: true,
          retryAfterSeconds: Math.max(1, Math.ceil((entry.firstAt + windowMs - now) / 1000)),
        };
      }
      return { limited: false, retryAfterSeconds: 0 };
    },

    record(key: string, now: number = Date.now()): void {
      const entry = attempts.get(key);
      if (!entry || now - entry.firstAt > windowMs) {
        attempts.set(key, { count: 1, firstAt: now });
      } else {
        entry.count += 1;
      }
      prune(now);
    },

    reset(key: string): void {
      attempts.delete(key);
    },
  };
}

// 5 failures per 10 minutes per (client, email). Failed logins cost ~50ms of
// scrypt each, so this caps online guessing far below offline-crack rates.
export const loginRateLimiter = createRateLimiter({ maxAttempts: 5, windowMs: 10 * 60 * 1000 });

// Account creation is per-client (not per-email, since the email is the thing
// being chosen) and billed on attempts rather than failures: a tight ceiling
// keeps this from being used to bulk-create accounts.
export const registerRateLimiter = createRateLimiter({ maxAttempts: 5, windowMs: 60 * 60 * 1000 });

// Demo entry point: per-client, so one visitor hammering the button cannot
// exhaust the shared demo session for everyone else.
export const demoRateLimiter = createRateLimiter({ maxAttempts: 20, windowMs: 10 * 60 * 1000 });
