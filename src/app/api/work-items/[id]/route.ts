import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { toErrorResponse, Errors } from "@/lib/errors";
import { getWorkItem, updateWorkItem } from "@/modules/work-items/service";
import { updateWorkItemSchema } from "@/modules/work-items/schemas";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser();
    if (!user) throw Errors.unauthenticated();
    const { id } = await ctx.params;
    const item = await getWorkItem(user, id);
    return NextResponse.json({ item });
  } catch (e) {
    return toErrorResponse(e);
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser();
    if (!user) throw Errors.unauthenticated();
    const { id } = await ctx.params;
    const input = updateWorkItemSchema.parse(await req.json());
    const item = await updateWorkItem(user, id, input);
    return NextResponse.json({ item });
  } catch (e) {
    return toErrorResponse(e);
  }
}
