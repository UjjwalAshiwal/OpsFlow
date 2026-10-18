import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { toErrorResponse, Errors } from "@/lib/errors";
import { getWorkItemStats } from "@/modules/work-items/service";

/** Exact per-status totals (GROUP BY). Static segment wins over [id], so
 *  /api/work-items/stats never collides with /api/work-items/:id. */
export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) throw Errors.unauthenticated();
    return NextResponse.json(await getWorkItemStats(user));
  } catch (e) {
    return toErrorResponse(e);
  }
}
