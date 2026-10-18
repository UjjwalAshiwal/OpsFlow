import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { Prisma } from "@prisma/client";
import type { User } from "@prisma/client";
import { db } from "./db";
import { hashPassword, sha256Hex, verifyPassword } from "./password";
import { ApiError } from "./errors";
import { loginRateLimiter, registerRateLimiter } from "./rate-limit";

export const SESSION_COOKIE = "nt_session";
// 7 days, sliding. Short enough to bound stolen-cookie use, long enough for a demo.
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type SessionUser = Pick<User, "id" | "email" | "name" | "role">;

/**
 * Client address used to build rate-limit keys.
 *
 * `x-forwarded-for` is client-settable, so on its own an attacker controls the
 * bucket and the limiter can be bypassed by rotating the header. Vercel
 * overwrites `x-vercel-forwarded-for` at the edge, so that one cannot be
 * forged and is preferred here. `x-real-ip` is the other common edge-provided
 * header. `x-forwarded-for` is only a last resort, and the fallback constant is
 * intentionally explicit so a missing header is never mistaken for a real IP.
 */
export function clientKey(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  return (
    req.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    xff?.split(",")[0]?.trim() ||
    "unknown"
  );
}

/** Human-facing lockout message that tells the user how long to wait. */
export function rateLimitedMessage(subject: string, retryAfterSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return `Too many ${subject}. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}

function hashToken(token: string): string {
  return sha256Hex(`session:${token}`);
}

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  await db.session.create({
    data: { tokenHash: hashToken(token), userId, expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
  });
  return token;
}

export async function destroySession(token: string | undefined): Promise<void> {
  if (!token) return;
  await db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}

/** Trusted server-side identity. Callers must never accept an actor id from the client. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  return getSessionUserByToken(store.get(SESSION_COOKIE)?.value);
}

/** Same lookup for server components/layouts that already hold the raw token. */
export async function getSessionUserByToken(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: { id: true, email: true, name: true, role: true } } },
  });
  if (!session || session.expiresAt.getTime() < Date.now()) {
    if (session) await db.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  return session.user;
}

export function sessionCookieOptions(expires: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
  };
}

export { SESSION_TTL_MS };

// A real scrypt hash of a throwaway password. Verifying against it costs the
// same ~50ms as a genuine check, so unknown-email and wrong-password failures
// are indistinguishable by timing (no account-enumeration oracle). Not a secret.
const DUMMY_HASH =
  "scrypt$b45b428eec9889410b2f66aaa04cb3b1$9b327e5809381e808212fc0ec0557b7d86e98f87008a23712de9494c87e713ea5337a8553616dc6754efabcfa66009003d150e5967e95bdedaa4293b71d225ba";

/**
 * Credential check with uniform failure behavior: identical code, message, and
 * cost for unknown emails and wrong passwords; per-client+email rate limiting
 * (429) after repeated failures; the limit resets on success.
 */
export async function authenticateUser(
  email: string,
  password: string,
  clientKey: string,
): Promise<SessionUser> {
  const scope = `login:${clientKey}:${email.toLowerCase()}`;
  const verdict = loginRateLimiter.check(scope);
  if (verdict.limited) {
    throw new ApiError(429, "RATE_LIMITED", rateLimitedMessage("login attempts", verdict.retryAfterSeconds), {
      retryAfterSeconds: verdict.retryAfterSeconds,
    });
  }
  const user = await db.user.findUnique({ where: { email: email.toLowerCase() } });
  const ok = user
    ? await verifyPassword(password, user.passwordHash)
    : await verifyPassword(password, DUMMY_HASH);
  if (!user || !ok) {
    loginRateLimiter.record(scope);
    // Same response for unknown email vs wrong password: no account enumeration.
    throw new ApiError(401, "INVALID_CREDENTIALS", "Invalid email or password.");
  }
  loginRateLimiter.reset(scope);
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

/**
 * Create an account. The caller-supplied shape intentionally excludes any
 * global role: `role` is left to Prisma's @default(USER), so this path can
 * never mint an ADMIN. No team membership is created either — team access is
 * granted by an existing team LEAD via addMember().
 */
export async function registerUser(
  input: { name: string; email: string; password: string },
  clientKey: string,
): Promise<SessionUser> {
  const scope = `register:${clientKey}`;
  const verdict = registerRateLimiter.check(scope);
  if (verdict.limited) {
    throw new ApiError(429, "RATE_LIMITED", rateLimitedMessage("sign-up attempts", verdict.retryAfterSeconds), {
      retryAfterSeconds: verdict.retryAfterSeconds,
    });
  }
  registerRateLimiter.record(scope);

  const email = input.email.toLowerCase();
  let passwordHash: string;
  try {
    passwordHash = await hashPassword(input.password);
  } catch {
    // Never let a hashing failure echo the password or the input back out.
    throw new ApiError(400, "BAD_REQUEST", "Password could not be processed.");
  }

  try {
    const user = await db.user.create({
      data: { name: input.name.trim(), email, passwordHash },
    });
    return { id: user.id, email: user.email, name: user.name, role: user.role };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      // 409, not 400: the address is already registered. The message stays
      // generic so it reveals nothing beyond what the client submitted.
      throw new ApiError(409, "EMAIL_TAKEN", "An account with that email already exists.");
    }
    throw e;
  }
}
