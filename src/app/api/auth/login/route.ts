import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import {
  authenticateUser,
  clientKey,
  createSession,
  sessionCookieOptions,
  SESSION_COOKIE,
  SESSION_TTL_MS,
} from "@/lib/auth";
import { loginSchema } from "@/modules/work-items/schemas";

export async function POST(req: Request) {
  try {
    const body = loginSchema.parse(await req.json());
    const user = await authenticateUser(body.email, body.password, clientKey(req));
    const token = await createSession(user.id);
    const res = NextResponse.json({ user });
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(new Date(Date.now() + SESSION_TTL_MS)));
    return res;
  } catch (e) {
    return toErrorResponse(e);
  }
}
