import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { destroySession, getSessionUser, SESSION_COOKIE } from "@/lib/auth";
import { toErrorResponse } from "@/lib/errors";

export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ user: null });
    return NextResponse.json({ user });
  } catch (e) {
    return toErrorResponse(e);
  }
}

export async function DELETE() {
  try {
    const store = await cookies();
    await destroySession(store.get(SESSION_COOKIE)?.value);
    const res = NextResponse.json({ ok: true });
    res.cookies.delete(SESSION_COOKIE);
    return res;
  } catch (e) {
    return toErrorResponse(e);
  }
}
