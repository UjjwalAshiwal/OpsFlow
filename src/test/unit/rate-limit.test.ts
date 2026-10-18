import { describe, expect, it } from "vitest";
import { createRateLimiter } from "@/lib/rate-limit";

describe("rate limiter", () => {
  it("allows attempts under the cap", () => {
    const rl = createRateLimiter({ maxAttempts: 3, windowMs: 60000 });
    for (let i = 0; i < 3; i++) {
      expect(rl.check("k").limited).toBe(false);
      rl.record("k");
    }
  });

  it("blocks at the cap and reports a positive retry delay", () => {
    const rl = createRateLimiter({ maxAttempts: 2, windowMs: 60000 });
    rl.record("k");
    rl.record("k");
    const v = rl.check("k", Date.now());
    expect(v.limited).toBe(true);
    expect(v.retryAfterSeconds).toBeGreaterThan(0);
    expect(v.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it("resets after the window elapses", () => {
    const rl = createRateLimiter({ maxAttempts: 1, windowMs: 100 });
    rl.record("k", 1000);
    expect(rl.check("k", 1050).limited).toBe(true);
    expect(rl.check("k", 1200).limited).toBe(false);
  });

  it("tracks keys independently and forgets on reset", () => {
    const rl = createRateLimiter({ maxAttempts: 1, windowMs: 60000 });
    rl.record("a");
    expect(rl.check("a").limited).toBe(true);
    expect(rl.check("b").limited).toBe(false);
    rl.reset("a");
    expect(rl.check("a").limited).toBe(false);
  });
});
