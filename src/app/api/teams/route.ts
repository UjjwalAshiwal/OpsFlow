import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { toErrorResponse, Errors } from "@/lib/errors";
import { createTeam, listTeams } from "@/modules/teams";
import { createTeamSchema } from "@/modules/teams";

export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) throw Errors.unauthenticated();
    return NextResponse.json({ teams: await listTeams(user) });
  } catch (e) {
    return toErrorResponse(e);
  }
}

export async function POST(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) throw Errors.unauthenticated();
    const input = createTeamSchema.parse(await req.json());
    const team = await createTeam(user, input);
    return NextResponse.json({ team }, { status: 201 });
  } catch (e) {
    return toErrorResponse(e);
  }
}
