import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { toErrorResponse, Errors } from "@/lib/errors";
import {
  createWorkItem,
  listWorkItems,
} from "@/modules/work-items/service";
import { createWorkItemSchema, listQuerySchema } from "@/modules/work-items/schemas";

export async function GET(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) throw Errors.unauthenticated();
    const url = new URL(req.url);
    const query = listQuerySchema.parse({
      status: url.searchParams.get("status") ?? undefined,
      priority: url.searchParams.get("priority") ?? undefined,
      q: url.searchParams.get("q") ?? undefined,
      assigneeId: url.searchParams.get("assigneeId") ?? undefined,
      creatorId: url.searchParams.get("creatorId") ?? undefined,
      teamId: url.searchParams.get("teamId") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
      cursor: url.searchParams.get("cursor") ?? undefined,
    });
    const result = await listWorkItems(user, query);
    return NextResponse.json(result);
  } catch (e) {
    return toErrorResponse(e);
  }
}

export async function POST(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) throw Errors.unauthenticated();
    const input = createWorkItemSchema.parse(await req.json());
    const { item, statusCode, replayed } = await createWorkItem(
      user,
      {
        title: input.title,
        description: input.description,
        assigneeId: input.assigneeId ?? null,
        teamId: input.teamId ?? null,
        priority: input.priority,
      },
      req.headers.get("Idempotency-Key"),
    );
    const res = NextResponse.json({ item }, { status: statusCode });
    if (replayed) res.headers.set("Idempotent-Replayed", "true");
    return res;
  } catch (e) {
    return toErrorResponse(e);
  }
}
