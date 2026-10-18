import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { toErrorResponse, Errors } from "@/lib/errors";
import { removeMember } from "@/modules/teams";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string; userId: string }> }) {
  try {
    const user = await getSessionUser();
    if (!user) throw Errors.unauthenticated();
    const { id, userId } = await ctx.params;
    return NextResponse.json(await removeMember(user, id, userId));
  } catch (e) {
    return toErrorResponse(e);
  }
}
