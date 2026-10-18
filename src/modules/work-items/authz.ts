import type { WorkItem } from "@prisma/client";
import type { SessionUser } from "@/lib/auth";

// Resource-level policy (team semantics are task-specified — the original brief
// is unavailable; see ENGINEERING_DECISIONS.md §15):
// - Teamless (legacy) items stay visible to every authenticated user, as before.
// - Team items are visible only to team members (or global ADMIN). Invisible ids
//   are plain 404s, so no cross-team existence leaks.
// - Mutations need creator, assignee, global ADMIN, or LEAD of the item's team.
//   Plain MEMBERs mutate only items they created or own.
// - Assignee changes are part of mutation permission (no separate policy).
// Pure functions: unit-tested, reused by every route. No permission framework:
// two roles and three rules do not justify CASL.

export type TeamMembershipRole = "LEAD" | "MEMBER" | null; // null = not a member

export function canRead(
  user: SessionUser,
  item: Pick<WorkItem, "teamId">,
  membership: TeamMembershipRole = null,
): boolean {
  if (user.role === "ADMIN") return true;
  if (!item.teamId) return true;
  return membership !== null;
}

export function canMutate(
  user: SessionUser,
  item: Pick<WorkItem, "creatorId" | "assigneeId" | "teamId">,
  membership: TeamMembershipRole = null,
): boolean {
  if (user.role === "ADMIN") return true;
  if (item.creatorId === user.id || item.assigneeId === user.id) return true;
  if (item.teamId && membership === "LEAD") return true;
  return false;
}
