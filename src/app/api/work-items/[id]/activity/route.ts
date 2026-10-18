import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { toErrorResponse, Errors } from "@/lib/errors";
import { getActivity } from "@/modules/work-items/service";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser();
    if (!user) throw Errors.unauthenticated();
    const { id } = await ctx.params;
    const events = await getActivity(user, id);
    return NextResponse.json({ events });
  } catch (e) {
    return toErrorResponse(e);
  }
}
