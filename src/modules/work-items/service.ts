import { Prisma, type PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError, Errors } from "@/lib/errors";
import { sha256Hex } from "@/lib/password";
import { cursorFor, decodeCursor } from "@/lib/cursor";
import type { SessionUser } from "@/lib/auth";
import { canMutate, canRead, type TeamMembershipRole } from "./authz";
import { teamRole, userTeamIds } from "@/modules/teams";
import { idempotencyKeySchema } from "./schemas";
import { checkTransition, type Status } from "./workflow";

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // completed results replay for 24h
// Claims start PENDING with a short fuse so a crashed/rolled-back request frees
// the key within minutes; completing the business write extends it to the full TTL.
const PENDING_TIMEOUT_MS = 5 * 60 * 1000;

const itemInclude = {
  creator: { select: { id: true, name: true, email: true } },
  assignee: { select: { id: true, name: true, email: true } },
  team: { select: { id: true, name: true } },
} as const;

type ItemRow = Prisma.WorkItemGetPayload<{ include: typeof itemInclude }>;

export function serializeWorkItem(w: ItemRow) {
  return {
    id: w.id,
    title: w.title,
    description: w.description,
    status: w.status,
    priority: w.priority,
    version: w.version,
    creator: w.creator,
    assignee: w.assignee,
    team: w.team,
    idempotencyKey: w.idempotencyKey,
    createdAt: w.createdAt.toISOString(),
    updatedAt: w.updatedAt.toISOString(),
  };
}
export type SerializedWorkItem = ReturnType<typeof serializeWorkItem>;

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

async function assertAssigneeEligible(
  tx: Prisma.TransactionClient,
  assigneeId: string,
  teamId: string | null,
  teamName: string | null,
): Promise<void> {
  const assignee = await tx.user.findUnique({ where: { id: assigneeId } });
  if (!assignee) throw Errors.badRequest("Assignee does not exist.");
  if (teamId) {
    const role = await teamRole(tx, assigneeId, teamId);
    if (!role) {
      throw Errors.badRequest(
        `Assignee must be a member of team ${teamName ?? teamId}.`,
      );
    }
  }
}

async function assertTeamWritable(
  tx: Prisma.TransactionClient,
  user: SessionUser,
  teamId: string,
): Promise<{ id: string; name: string }> {
  const team = await tx.team.findUnique({ where: { id: teamId } });
  if (!team) throw Errors.notFound("Team");
  if (user.role !== "ADMIN") {
    const role = await teamRole(tx, user.id, teamId);
    if (!role) throw Errors.forbidden();
  }
  return team;
}

async function roleFor(
  client: Prisma.TransactionClient | PrismaClient,
  user: SessionUser,
  item: { teamId: string | null },
): Promise<TeamMembershipRole> {
  // ADMINs bypass membership and teamless items need none; canRead/canMutate
  // check user.role first, so null is safe in both cases here.
  if (user.role === "ADMIN" || !item.teamId) return null;
  return teamRole(client, user.id, item.teamId);
}

async function loadItemOr404(id: string) {
  const item = await db.workItem.findUnique({ where: { id }, include: itemInclude });
  if (!item) throw Errors.notFound("Work item");
  return item;
}

export interface CreateInput {
  title: string;
  description: string;
  assigneeId?: string | null;
  teamId?: string | null;
  priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
}

function fingerprintFor(input: CreateInput): string {
  return sha256Hex(
    JSON.stringify({
      t: input.title,
      d: input.description ?? "",
      a: input.assigneeId ?? null,
      tm: input.teamId ?? null,
      p: input.priority ?? "MEDIUM",
    }),
  );
}

// --- Create (idempotent when a key is supplied) ---

export interface CreateResult {
  item: SerializedWorkItem;
  statusCode: 200 | 201;
  replayed: boolean;
}

async function transactionalCreate(
  tx: Prisma.TransactionClient,
  user: SessionUser,
  input: CreateInput,
  idempotencyKey: string | null,
): Promise<SerializedWorkItem> {
  let team: { id: string; name: string } | null = null;
  if (input.teamId) team = await assertTeamWritable(tx, user, input.teamId);
  if (input.assigneeId) {
    await assertAssigneeEligible(tx, input.assigneeId, team?.id ?? null, team?.name ?? null);
  }
  const item = await tx.workItem.create({
    data: {
      title: input.title,
      description: input.description ?? "",
      assigneeId: input.assigneeId ?? null,
      teamId: team?.id ?? null,
      priority: input.priority ?? "MEDIUM",
      creatorId: user.id,
      idempotencyKey,
    },
    include: itemInclude,
  });
  await tx.activityEvent.create({
    data: { workItemId: item.id, actorId: user.id, type: "CREATED", toStatus: "OPEN" },
  });
  return serializeWorkItem(item);
}

export async function createWorkItem(
  user: SessionUser,
  input: CreateInput,
  keyRaw: string | null,
): Promise<CreateResult> {
  if (!keyRaw) {
    const item = await db.$transaction((tx) => transactionalCreate(tx, user, input, null));
    return { item, statusCode: 201, replayed: false };
  }

  const key = idempotencyKeySchema.parse(keyRaw);
  const fingerprint = fingerprintFor(input);
  const scope = `POST:/api/work-items:${user.id}`;
  const now = new Date();

  let claim;
  try {
    claim = await db.idempotencyRecord.create({
      data: { scope, key, fingerprint, status: "PENDING", expiresAt: new Date(now.getTime() + PENDING_TIMEOUT_MS) },
    });
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    // Lost the race (or this is a retry): resolve against the committed row.
    // Reads its own transaction, so it only ever sees committed results.
    const existing = await db.idempotencyRecord.findUnique({ where: { scope_key: { scope, key } } });
    if (!existing || existing.expiresAt.getTime() < now.getTime()) {
      // TTL elapsed (or stale PENDING claim): reap and start over. deleteMany is
      // idempotent, so concurrent reapers stay safe; the loser's create hits
      // P2002 again and lands here with a fresh PENDING row -> IN_PROGRESS.
      if (existing) await db.idempotencyRecord.deleteMany({ where: { id: existing.id } }).catch(() => {});
      return createWorkItem(user, input, keyRaw);
    }
    if (existing.fingerprint !== fingerprint) throw Errors.idempotencyConflict();
    if (existing.status === "PENDING") throw Errors.idempotencyInProgress();
    return { item: existing.body as unknown as SerializedWorkItem, statusCode: 200, replayed: true };
  }

  try {
    const item = await db.$transaction(async (tx) => {
      const created = await transactionalCreate(tx, user, input, key);
      await tx.idempotencyRecord.update({
        where: { id: claim.id },
        data: { status: "COMPLETED", statusCode: 201, body: created as unknown as Prisma.InputJsonValue, workItemId: created.id, expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS) },
      });
      return created;
    });
    return { item, statusCode: 201, replayed: false };
  } catch (e) {
    // Business write rolled back: never leave a completed result behind. Drop
    // the PENDING claim so an identical retry starts clean (no duplicate events).
    await db.idempotencyRecord.deleteMany({ where: { id: claim.id, status: "PENDING" } }).catch(() => {});
    throw e;
  }
}

/** Housekeeping for expired rows. Run on a schedule; expiry is enforced on read regardless. */
export async function pruneExpiredIdempotencyKeys(): Promise<number> {
  const res = await db.idempotencyRecord.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return res.count;
}

// --- Read / list ---

export interface ListFilters {
  status?: Status;
  priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  q?: string;
  assigneeId?: string;
  creatorId?: string;
  teamId?: string;
  limit: number;
  cursor?: string;
}

// Teamless (legacy) items are visible to all authenticated users; team items
// only to members. Global ADMINs see everything.
async function visibilityClause(user: SessionUser): Promise<Prisma.WorkItemWhereInput> {
  if (user.role === "ADMIN") return {};
  const teamIds = await userTeamIds(user.id);
  return { OR: [{ teamId: null }, { teamId: { in: teamIds } }] };
}

export async function listWorkItems(user: SessionUser, filters: ListFilters) {
  const { status, priority, q, assigneeId, creatorId, teamId, limit } = filters;
  const where: Prisma.WorkItemWhereInput = {
    ...(status ? { status } : {}),
    ...(priority ? { priority } : {}),
    ...(assigneeId ? { assigneeId } : {}),
    ...(creatorId ? { creatorId } : {}),
    ...(teamId ? { teamId } : {}),
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: "insensitive" as const } },
            { description: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };
  const and: Prisma.WorkItemWhereInput[] = [await visibilityClause(user)];
  if (filters.cursor) {
    const c = decodeCursor(filters.cursor);
    const at = new Date(c.createdAt);
    and.push({ OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: c.id } }] });
  }
  where.AND = and;
  const rows = await db.workItem.findMany({
    where,
    include: itemInclude,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return {
    items: page.map(serializeWorkItem),
    nextCursor: hasMore ? cursorFor(page[page.length - 1]) : null,
  };
}

export async function getWorkItem(user: SessionUser, id: string) {
  const item = await loadItemOr404(id);
  if (!canRead(user, item, await roleFor(db, user, item))) throw Errors.notFound("Work item");
  return serializeWorkItem(item);
}

// Exact per-status totals via GROUP BY — no row fetching. Scoped to the same
// visible set as list, so counts never leak cross-team items.
export async function getWorkItemStats(user: SessionUser): Promise<{ counts: Record<Status, number>; total: number }> {
  const where: Prisma.WorkItemWhereInput = { AND: [await visibilityClause(user)] };
  const rows = await db.workItem.groupBy({ by: ["status"], where, _count: { _all: true } });
  const counts: Record<Status, number> = {
    OPEN: 0,
    IN_PROGRESS: 0,
    REVIEW: 0,
    DONE: 0,
    CANCELLED: 0,
  };
  for (const row of rows) counts[row.status] = row._count._all;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return { counts, total };
}

export async function getActivity(user: SessionUser, id: string) {
  const item = await loadItemOr404(id);
  if (!canRead(user, item, await roleFor(db, user, item))) throw Errors.notFound("Work item");
  const events = await db.activityEvent.findMany({
    where: { workItemId: id },
    include: { actor: { select: { id: true, name: true, email: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 100,
  });
  return events.map((e) => ({
    id: e.id,
    type: e.type,
    actor: e.actor,
    fromStatus: e.fromStatus,
    toStatus: e.toStatus,
    changes: e.changes,
    createdAt: e.createdAt.toISOString(),
  }));
}

// --- Update (field edits, optimistic concurrency) ---

export interface UpdateInput {
  version: number;
  title?: string;
  description?: string;
  assigneeId?: string | null;
  teamId?: string | null;
  priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
}

export async function updateWorkItem(user: SessionUser, id: string, input: UpdateInput) {
  return db.$transaction(async (tx) => {
    const current = await tx.workItem.findUnique({ where: { id }, include: itemInclude });
    if (!current) throw Errors.notFound("Work item");
    const role = await roleFor(tx, user, current);
    if (!canRead(user, current, role)) throw Errors.notFound("Work item");
    if (!canMutate(user, current, role)) throw Errors.forbidden();
    if (current.version !== input.version) throw Errors.staleVersion();

    // Resolve the target team first: membership in it is required to move the item.
    let targetTeam: { id: string; name: string } | null = current.team;
    if (input.teamId !== undefined) {
      targetTeam = input.teamId ? await assertTeamWritable(tx, user, input.teamId) : null;
    }
    const teamChanged = (targetTeam?.id ?? null) !== (current.teamId ?? null);
    // The resulting assignee must be eligible in the target team whenever the
    // assignee or the team is touched.
    const nextAssignee = input.assigneeId !== undefined ? input.assigneeId : current.assigneeId;
    if (nextAssignee && (input.assigneeId !== undefined || teamChanged)) {
      await assertAssigneeEligible(tx, nextAssignee, targetTeam?.id ?? null, targetTeam?.name ?? null);
    }

    const changes: Record<string, { from: unknown; to: unknown }> = {};
    if (input.title !== undefined && input.title !== current.title)
      changes.title = { from: current.title, to: input.title };
    if (input.description !== undefined && input.description !== current.description)
      changes.description = { from: current.description, to: input.description };
    if (nextAssignee !== current.assigneeId)
      changes.assigneeId = { from: current.assigneeId, to: nextAssignee };
    if (teamChanged)
      changes.team = { from: current.team?.name ?? null, to: targetTeam?.name ?? null };
    if (input.priority !== undefined && input.priority !== current.priority)
      changes.priority = { from: current.priority, to: input.priority };

    if (Object.keys(changes).length === 0) return serializeWorkItem(current);

    // Conditional update: version in WHERE. Zero rows -> someone won the race.
    const res = await tx.workItem.updateMany({
      where: { id, version: input.version },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
        ...(teamChanged ? { teamId: targetTeam?.id ?? null } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        version: { increment: 1 },
      },
    });
    if (res.count === 0) throw Errors.staleVersion();
    await tx.activityEvent.create({
      data: { workItemId: id, actorId: user.id, type: "FIELD_UPDATED", changes: changes as unknown as Prisma.InputJsonValue },
    });
    const updated = await tx.workItem.findUniqueOrThrow({ where: { id }, include: itemInclude });
    return serializeWorkItem(updated);
  });
}

// --- Transition (workflow + concurrency + history, one transaction) ---

export interface TransitionInput {
  version: number;
  to: Status;
  assigneeId?: string | null;
}

export async function transitionWorkItem(user: SessionUser, id: string, input: TransitionInput) {
  return db.$transaction(async (tx) => {
    const current = await tx.workItem.findUnique({ where: { id }, include: itemInclude });
    if (!current) throw Errors.notFound("Work item");
    const role = await roleFor(tx, user, current);
    if (!canRead(user, current, role)) throw Errors.notFound("Work item");
    if (!canMutate(user, current, role)) throw Errors.forbidden();
    if (current.version !== input.version) throw Errors.staleVersion();

    const effectiveAssignee = input.assigneeId !== undefined ? input.assigneeId : current.assigneeId;
    const check = checkTransition(current.status, input.to, effectiveAssignee);
    if (!check.ok) {
      if (check.kind === "illegal") throw Errors.invalidTransition(current.status, input.to);
      throw new ApiError(422, "PRECONDITION_FAILED", check.reason);
    }
    if (effectiveAssignee) {
      await assertAssigneeEligible(tx, effectiveAssignee, current.teamId, current.team?.name ?? null);
    }

    // version AND expected state in WHERE: lost updates and raced transitions both fail here.
    const res = await tx.workItem.updateMany({
      where: { id, version: input.version, status: current.status },
      data: {
        status: input.to,
        ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
        version: { increment: 1 },
      },
    });
    // Never report zero-row updates as success. Item existence was proven
    // above and items are never deleted, so this is always a race -> 409.
    if (res.count === 0) throw Errors.staleVersion();
    await tx.activityEvent.create({
      data: {
        workItemId: id,
        actorId: user.id,
        type: "STATE_CHANGED",
        fromStatus: current.status,
        toStatus: input.to,
        ...(input.assigneeId !== undefined && input.assigneeId !== current.assigneeId
          ? { changes: { assigneeId: { from: current.assigneeId, to: input.assigneeId } } as unknown as Prisma.InputJsonValue }
          : {}),
      },
    });
    const updated = await tx.workItem.findUniqueOrThrow({ where: { id }, include: itemInclude });
    return serializeWorkItem(updated);
  });
}
