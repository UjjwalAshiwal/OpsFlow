import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { toErrorResponse, Errors } from "@/lib/errors";

/** Directory for assignee selection. Authenticated users only; names + emails are in-team data. */
export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) throw Errors.unauthenticated();
    const users = await db.user.findMany({
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
      take: 200,
    });
    return NextResponse.json({ users });
  } catch (e) {
    return toErrorResponse(e);
  }
}
