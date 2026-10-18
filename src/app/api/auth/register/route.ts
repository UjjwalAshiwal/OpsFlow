import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import {
  clientKey,
  createSession,
  registerUser,
  sessionCookieOptions,
  SESSION_COOKIE,
  SESSION_TTL_MS,
} from "@/lib/auth";
import { registerSchema } from "@/modules/work-items/schemas";

/** Public endpoint — no session required. Creates a USER and signs them in. */
export async function POST(req: Request) {
  try {
    const body = registerSchema.parse(await req.json());
    const user = await registerUser(body, clientKey(req));
    // Same session mechanism as login: opaque token, hashed at rest, HTTP-only cookie.
    const token = await createSession(user.id);
    const res = NextResponse.json({ user }, { status: 201 });
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(new Date(Date.now() + SESSION_TTL_MS)));
    return res;
  } catch (e) {
    return toErrorResponse(e);
  }
}