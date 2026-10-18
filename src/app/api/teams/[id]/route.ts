import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { toErrorResponse, Errors } from "@/lib/errors";
import { deleteTeam, getTeam } from "@/modules/teams";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser();
    if (!user) throw Errors.unauthenticated();
    const { id } = await ctx.params;
    return NextResponse.json({ team: await getTeam(user, id) });
  } catch (e) {
    return toErrorResponse(e);
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser();
    if (!user) throw Errors.unauthenticated();
    const { id } = await ctx.params;
    return NextResponse.json(await deleteTeam(user, id));
  } catch (e) {
    return toErrorResponse(e);
  }
}
