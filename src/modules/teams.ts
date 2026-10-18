import { z } from "zod";
import { Prisma, type PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError, Errors } from "@/lib/errors";
import type { SessionUser } from "@/lib/auth";

export const TEAM_ROLES = ["MEMBER", "LEAD"] as const;

export const createTeamSchema = z.object({
  name: z.string().trim().min(1, "Team name is required.").max(100),
});

export const addMemberSchema = z.object({
  userId: z.string().min(1).max(64),
  role: z.enum(TEAM_ROLES).default("MEMBER"),
});

export type TeamRoleName = "LEAD" | "MEMBER";

export async function teamRole(
  client: Prisma.TransactionClient | PrismaClient,
  userId: string,
  teamId: string,
): Promise<TeamRoleName | null> {
  const m = await (client as Prisma.TransactionClient).teamMembership.findUnique({
    where: { userId_teamId: { userId, teamId } },
  });
  return m?.role ?? null;
}

export async function userTeamIds(userId: string): Promise<string[]> {
  const rows = await db.teamMembership.findMany({ where: { userId }, select: { teamId: true } });
  return rows.map((r) => r.teamId);
}

async function loadTeamOr404(id: string) {
  const team = await db.team.findUnique({
    where: { id },
    include: {
      memberships: { include: { user: { select: { id: true, name: true, email: true } } } },
      _count: { select: { workItems: true } },
    },
  });
  if (!team) throw Errors.notFound("Team");
  return team;
}

/** Teams are visible to members (any role) and global ADMINs; otherwise 404. */
async function requireTeamVisible(user: SessionUser, teamId: string) {
  const team = await loadTeamOr404(teamId);
  if (user.role === "ADMIN") return team;
  const role = await teamRole(db, user.id, teamId);
  if (!role) throw Errors.notFound("Team");
  return team;
}

function serializeTeam(
  team: { id: string; name: string; createdAt: Date },
  memberCount: number,
  myRole: TeamRoleName | null,
) {
  return { id: team.id, name: team.name, memberCount, myRole, createdAt: team.createdAt.toISOString() };
}

export async function createTeam(user: SessionUser, input: { name: string }) {
  return db.$transaction(async (tx) => {
    const team = await tx.team.create({ data: { name: input.name } });
    await tx.teamMembership.create({ data: { userId: user.id, teamId: team.id, role: "LEAD" } });
    return serializeTeam(team, 1, "LEAD");
  });
}

export async function listTeams(user: SessionUser) {
  if (user.role === "ADMIN") {
    const teams = await db.team.findMany({
      include: { memberships: { select: { userId: true, role: true } } },
      orderBy: { name: "asc" },
    });
    return teams.map((t) => {
      const own = t.memberships.find((m) => m.userId === user.id);
      return serializeTeam(t, t.memberships.length, own?.role ?? null);
    });
  }
  const memberships = await db.teamMembership.findMany({
    where: { userId: user.id },
    include: { team: { include: { _count: { select: { memberships: true } } } } },
    orderBy: { team: { name: "asc" } },
  });
  return memberships.map((m) => serializeTeam(m.team, m.team._count.memberships, m.role));
}

export async function getTeam(user: SessionUser, id: string) {
  const team = await requireTeamVisible(user, id);
  const myRole = await teamRole(db, user.id, id);
  return {
    ...serializeTeam(team, team.memberships.length, myRole),
    members: team.memberships.map((m) => ({ ...m.user, role: m.role })),
    itemCount: team._count.workItems,
  };
}

export async function addMember(actor: SessionUser, teamId: string, input: { userId: string; role: "MEMBER" | "LEAD" }) {
  await requireTeamVisible(actor, teamId);
  const actorRole = actor.role === "ADMIN" ? "LEAD" : await teamRole(db, actor.id, teamId);
  if (actorRole !== "LEAD") throw Errors.forbidden();
  const target = await db.user.findUnique({ where: { id: input.userId } });
  if (!target) throw Errors.badRequest("User does not exist.");
  const membership = await db.teamMembership.upsert({
    where: { userId_teamId: { userId: input.userId, teamId } },
    update: { role: input.role },
    create: { userId: input.userId, teamId, role: input.role },
  });
  return { userId: membership.userId, teamId: membership.teamId, role: membership.role };
}

export async function removeMember(actor: SessionUser, teamId: string, userId: string) {
  await requireTeamVisible(actor, teamId);
  const actorRole = actor.role === "ADMIN" ? "LEAD" : await teamRole(db, actor.id, teamId);
  if (actorRole !== "LEAD") throw Errors.forbidden();
  const target = await db.teamMembership.findUnique({ where: { userId_teamId: { userId, teamId } } });
  if (!target) throw Errors.notFound("Membership");
  if (target.role === "LEAD") {
    const leads = await db.teamMembership.count({ where: { teamId, role: "LEAD" } });
    if (leads <= 1) throw Errors.badRequest("Cannot remove the last lead of a team.");
  }
  await db.teamMembership.delete({ where: { id: target.id } });
  return { ok: true };
}

export async function deleteTeam(actor: SessionUser, teamId: string) {
  await requireTeamVisible(actor, teamId);
  const actorRole = actor.role === "ADMIN" ? "LEAD" : await teamRole(db, actor.id, teamId);
  if (actorRole !== "LEAD") throw Errors.forbidden();
  try {
    await db.team.delete({ where: { id: teamId } });
  } catch (e) {
    // WorkItem.teamId is ON DELETE RESTRICT: teams holding items cannot vanish.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
      throw new ApiError(409, "TEAM_IN_USE", "This team still has work items. Move them first.");
    }
    throw e;
  }
  return { ok: true };
}
