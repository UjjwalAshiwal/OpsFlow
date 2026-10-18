import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { toErrorResponse, Errors } from "@/lib/errors";
import { addMember, addMemberSchema } from "@/modules/teams";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser();
    if (!user) throw Errors.unauthenticated();
    const { id } = await ctx.params;
    const input = addMemberSchema.parse(await req.json());
    const membership = await addMember(user, id, input);
    return NextResponse.json({ membership }, { status: 201 });
  } catch (e) {
    return toErrorResponse(e);
  }
}
