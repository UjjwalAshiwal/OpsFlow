import { describe, expect, it } from "vitest";
import { clientKey, rateLimitedMessage } from "@/lib/auth";

function req(headers: Record<string, string>): Request {
  return new Request("https://example.test/api/auth/login", { headers });
}

describe("clientKey", () => {
  // Regression: the limiter was previously keyed on the client-settable
  // x-forwarded-for first hop, which lets an attacker rotate the header and
  // bypass the login limiter entirely.
  it("ignores a spoofed x-forwarded-for when the edge supplies the real address", () => {
    const k = clientKey(req({ "x-forwarded-for": "6.6.6.6", "x-vercel-forwarded-for": "203.0.113.7" }));
    expect(k).toBe("203.0.113.7");
  });

  it("takes the first hop of the Vercel header when it lists a chain", () => {
    expect(clientKey(req({ "x-vercel-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip when the Vercel header is absent", () => {
    expect(clientKey(req({ "x-real-ip": "198.51.100.4" }))).toBe("198.51.100.4");
  });

  it("falls back to x-forwarded-for only as a last resort", () => {
    expect(clientKey(req({ "x-forwarded-for": "192.0.2.9, 10.0.0.1" }))).toBe("192.0.2.9");
  });

  it("returns an explicit marker when no address header is present", () => {
    expect(clientKey(req({}))).toBe("unknown");
  });

  it("trims whitespace so equivalent addresses share one bucket", () => {
    expect(clientKey(req({ "x-vercel-forwarded-for": "  203.0.113.7  " }))).toBe("203.0.113.7");
  });

  it("gives different addresses different rate-limit buckets", () => {
    expect(clientKey(req({ "x-vercel-forwarded-for": "203.0.113.7" }))).not.toBe(
      clientKey(req({ "x-vercel-forwarded-for": "203.0.113.8" })),
    );
  });
});

describe("rateLimitedMessage", () => {
  it("tells the user how long to wait", () => {
    expect(rateLimitedMessage("login attempts", 600)).toBe("Too many login attempts. Try again in 10 minutes.");
  });

  it("rounds a sub-minute wait up to one minute", () => {
    expect(rateLimitedMessage("login attempts", 1)).toBe("Too many login attempts. Try again in 1 minute.");
  });

  it("uses the plural for multi-minute waits", () => {
    expect(rateLimitedMessage("sign-up attempts", 120)).toBe("Too many sign-up attempts. Try again in 2 minutes.");
  });
});
