import { NextResponse } from "next/server";
import { toErrorResponse, ApiError } from "@/lib/errors";
import {
  clientKey,
  createSession,
  rateLimitedMessage,
  sessionCookieOptions,
  SESSION_COOKIE,
  SESSION_TTL_MS,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { demoRateLimiter } from "@/lib/rate-limit";

// The single identity offered by the "Explore Demo" button.
//
// The visitor never supplies an identity: this endpoint resolves exactly one
// server-side account, then issues that account's session through the same
// createSession()/sessionCookieOptions() path as a normal login. There is no
// impersonation parameter and no way to select another user.
//
// The account is a demo tenant member, never a global ADMIN, and it is
// explicitly shared and mutable — anyone using the demo can change what other
// visitors see. That is the intended trade-off for a public sample workspace.
const DEMO_EMAIL = "olivia.carter@demo.opsflow.invalid";

export async function POST(req: Request) {
  try {
    const scope = `demo:${clientKey(req)}`;
    const verdict = demoRateLimiter.check(scope);
    if (verdict.limited) {
      throw new ApiError(429, "RATE_LIMITED", rateLimitedMessage("demo requests", verdict.retryAfterSeconds), {
        retryAfterSeconds: verdict.retryAfterSeconds,
      });
    }
    demoRateLimiter.record(scope);

    const demo = await db.user.findUnique({ where: { email: DEMO_EMAIL } });
    if (!demo) {
      // Demo dataset has not been seeded on this deployment.
      throw new ApiError(503, "DEMO_UNAVAILABLE", "The demo workspace is not available right now.");
    }
    if (demo.role === "ADMIN") {
      // Defence in depth: never hand out a session for an admin account.
      throw new ApiError(503, "DEMO_UNAVAILABLE", "The demo workspace is not available right now.");
    }

    const token = await createSession(demo.id);
    const res = NextResponse.json({ user: { id: demo.id, email: demo.email, name: demo.name, role: demo.role } });
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(new Date(Date.now() + SESSION_TTL_MS)));
    return res;
  } catch (e) {
    return toErrorResponse(e);
  }
}