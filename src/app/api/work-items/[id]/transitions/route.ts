import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { toErrorResponse, Errors } from "@/lib/errors";
import { transitionWorkItem } from "@/modules/work-items/service";
import { transitionSchema } from "@/modules/work-items/schemas";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser();
    if (!user) throw Errors.unauthenticated();
    const { id } = await ctx.params;
    const input = transitionSchema.parse(await req.json());
    const item = await transitionWorkItem(user, id, {
      version: input.version,
      to: input.to,
      ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
    });
    return NextResponse.json({ item });
  } catch (e) {
    return toErrorResponse(e);
  }
}
