import { beforeEach, describe, expect, it } from "vitest";
import { assertTestDatabase, makeUser, resetDb } from "./helpers";
import type { SessionUser } from "@/lib/auth";
import {
  createWorkItem,
  getActivity,
  getWorkItem,
  getWorkItemStats,
  listWorkItems,
  transitionWorkItem,
  updateWorkItem,
} from "@/modules/work-items/service";
import {
  addMember,
  createTeam,
  deleteTeam,
  getTeam,
  listTeams,
  removeMember,
} from "@/modules/teams";

// Real PostgreSQL, isolated test database.
// NOTE: every file in this directory shares the one test database, so files
// run sequentially (fileParallelism: false in vitest.config.mts).

let alice: SessionUser;
let bob: SessionUser;
let mallory: SessionUser;
let admin: SessionUser;

beforeEach(async () => {
  await assertTestDatabase();
  await resetDb();
  alice = await makeUser("alice@t.io");
  bob = await makeUser("bob@t.io");
  mallory = await makeUser("mallory@t.io");
  admin = await makeUser("admin@t.io", "ADMIN");
});

describe("team management", () => {
  it("creates a team with the creator as lead", async () => {
    const team = await createTeam(alice, { name: "Platform" });
    expect(team).toMatchObject({ name: "Platform", memberCount: 1, myRole: "LEAD" });
    const listed = await listTeams(alice);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ name: "Platform", myRole: "LEAD" });
    // Non-members see nothing.
    expect(await listTeams(mallory)).toHaveLength(0);
  });

  it("hides teams from non-members but not from admins", async () => {
    const team = await createTeam(alice, { name: "Platform" });
    await expect(getTeam(mallory, team.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const detail = await getTeam(alice, team.id);
    expect(detail.members.map((m) => m.email)).toEqual(["alice@t.io"]);
    expect(await getTeam(admin, team.id)).toMatchObject({ name: "Platform" });
    await expect(getTeam(alice, "no-such-team")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("lets leads manage the roster, not members or outsiders", async () => {
    const team = await createTeam(alice, { name: "Platform" });
    await expect(addMember(bob, team.id, { userId: bob.id, role: "MEMBER" })).rejects.toMatchObject({
      code: "NOT_FOUND", // bob cannot even see the team
    });
    const m = await addMember(alice, team.id, { userId: bob.id, role: "MEMBER" });
    expect(m).toMatchObject({ role: "MEMBER" });
    await expect(
      addMember(bob, team.id, { userId: mallory.id, role: "MEMBER" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      addMember(alice, team.id, { userId: "ghost", role: "MEMBER" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // Re-adding updates the role (idempotent roster writes).
    await addMember(alice, team.id, { userId: bob.id, role: "LEAD" });
    expect((await getTeam(alice, team.id)).members.find((x) => x.id === bob.id)?.role).toBe("LEAD");
  });

  it("protects the last lead and guards deletion", async () => {
    const team = await createTeam(alice, { name: "Platform" });
    await expect(removeMember(alice, team.id, alice.id)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await addMember(alice, team.id, { userId: bob.id, role: "LEAD" });
    await expect(removeMember(alice, team.id, alice.id)).resolves.toMatchObject({ ok: true });
    await expect(removeMember(bob, team.id, "ghost")).rejects.toMatchObject({ code: "NOT_FOUND" });

    // A team holding work items cannot be deleted.
    const item = await createWorkItem(bob, { title: "T", description: "", teamId: team.id }, null);
    void item;
    await expect(deleteTeam(bob, team.id)).rejects.toMatchObject({ code: "TEAM_IN_USE" });
    await expect(deleteTeam(mallory, team.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const empty = await createTeam(alice, { name: "Empty" });
    await expect(deleteTeam(alice, empty.id)).resolves.toMatchObject({ ok: true });
  });
});

describe("team-scoped work items", () => {
  async function platform() {
    const team = await createTeam(alice, { name: "Platform" });
    await addMember(alice, team.id, { userId: bob.id, role: "MEMBER" });
    return team;
  }

  it("requires membership to file items under a team", async () => {
    const team = await createTeam(alice, { name: "Platform" });
    await expect(
      createWorkItem(mallory, { title: "T", description: "", teamId: team.id }, null),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      createWorkItem(alice, { title: "T", description: "", teamId: "no-such-team" }, null),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const ok = await createWorkItem(alice, { title: "T", description: "", teamId: team.id }, null);
    expect(ok.item.team).toMatchObject({ id: team.id, name: "Platform" });
  });

  it("returns 404 (not 403) for cross-team reads and mutations", async () => {
    const team = await platform();
    const c = await createWorkItem(alice, { title: "T", description: "", teamId: team.id }, null);
    await expect(getWorkItem(mallory, c.item.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getActivity(mallory, c.item.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(updateWorkItem(mallory, c.item.id, { version: 1, title: "x" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      transitionWorkItem(mallory, c.item.id, { version: 1, to: "CANCELLED" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("lets leads mutate, denies plain members, keeps involvement rights", async () => {
    const team = await platform();
    const c = await createWorkItem(alice, { title: "T", description: "", teamId: team.id }, null);
    // bob is a MEMBER, not creator/assignee -> 403.
    await expect(updateWorkItem(bob, c.item.id, { version: 1, title: "x" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await addMember(alice, team.id, { userId: bob.id, role: "LEAD" });
    const moved = await updateWorkItem(bob, c.item.id, { version: 1, title: "by lead" });
    expect(moved.title).toBe("by lead");
    // Admin bypasses everything.
    const again = await updateWorkItem(admin, c.item.id, { version: 2, title: "by admin" });
    expect(again.title).toBe("by admin");
  });

  it("scopes list, search, and stats to visible items", async () => {
    const team = await platform();
    await createWorkItem(alice, { title: "team alpha", description: "", teamId: team.id }, null);
    await createWorkItem(alice, { title: "open legacy", description: "" }, null);
    const malloryView = await listWorkItems(mallory, { limit: 100 });
    expect(malloryView.items.map((i) => i.title)).toEqual(["open legacy"]);
    const bobView = await listWorkItems(bob, { limit: 100 });
    expect(bobView.items).toHaveLength(2);
    // Explicit filter into another team yields empty, never foreign rows.
    const filtered = await listWorkItems(mallory, { limit: 100, teamId: team.id });
    expect(filtered.items).toHaveLength(0);
    const own = await listWorkItems(bob, { limit: 100, teamId: team.id });
    expect(own.items).toHaveLength(1);
    // Search respects the same boundary.
    const search = await listWorkItems(mallory, { limit: 100, q: "alpha" });
    expect(search.items).toHaveLength(0);
    // Stats never leak cross-team items either.
    const stats = await getWorkItemStats(mallory);
    expect(stats.total).toBe(1);
    expect((await getWorkItemStats(admin)).total).toBe(2);
  });
});

describe("assignment rules", () => {
  it("requires team membership for assignees on team items", async () => {
    const team = await createTeam(alice, { name: "Platform" });
    await expect(
      createWorkItem(alice, { title: "T", description: "", teamId: team.id, assigneeId: mallory.id }, null),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const c = await createWorkItem(alice, { title: "T", description: "", teamId: team.id }, null);
    await expect(
      updateWorkItem(alice, c.item.id, { version: 1, assigneeId: mallory.id }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await addMember(alice, team.id, { userId: mallory.id, role: "MEMBER" });
    const assigned = await updateWorkItem(alice, c.item.id, { version: 1, assigneeId: mallory.id });
    expect(assigned.assignee?.id).toBe(mallory.id);
    // Clearing an assignment is always permitted for someone who may mutate.
    const cleared = await updateWorkItem(alice, c.item.id, { version: 2, assigneeId: null });
    expect(cleared.assignee).toBeNull();
  });

  it("records assignment changes in transactional history", async () => {
    const c = await createWorkItem(alice, { title: "T", description: "", assigneeId: bob.id }, null);
    await updateWorkItem(alice, c.item.id, { version: 1, assigneeId: null });
    const events = await getActivity(alice, c.item.id);
    const edit = events.find((e) => e.type === "FIELD_UPDATED");
    expect(edit?.changes).toMatchObject({ assigneeId: { from: bob.id, to: null } });
    // Failed assignment writes no history.
    const before = events.length;
    await expect(updateWorkItem(alice, c.item.id, { version: 2, assigneeId: "ghost" })).rejects.toThrow();
    expect(await getActivity(alice, c.item.id)).toHaveLength(before);
  });

  it("rejects moving an item where its assignee would become ineligible", async () => {
    const a = await createTeam(alice, { name: "A" });
    const b = await createTeam(alice, { name: "B" });
    const c = await createWorkItem(alice, { title: "T", description: "", teamId: a.id, assigneeId: alice.id }, null);
    // Alice leads both, but she is... a member of B too (creator-lead). Use mallory: member of A only.
    await addMember(alice, a.id, { userId: mallory.id, role: "MEMBER" });
    const d = await createWorkItem(alice, { title: "U", description: "", teamId: a.id, assigneeId: mallory.id }, null);
    // Moving mallory's item to B (mallory not a member) must fail, not strand her.
    await expect(updateWorkItem(alice, d.item.id, { version: 1, teamId: b.id })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect((await getWorkItem(alice, d.item.id)).team?.id).toBe(a.id);
    // A member who may see the item but not mutate it gets 403 (not 404):
    // visibility passes, mutation permission fails first.
    await addMember(alice, a.id, { userId: bob.id, role: "MEMBER" });
    await expect(updateWorkItem(bob, c.item.id, { version: 1, teamId: b.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("priority", () => {
  it("defaults to MEDIUM, stores explicit values, and filters on them", async () => {
    const d = await createWorkItem(alice, { title: "plain", description: "" }, null);
    expect(d.item.priority).toBe("MEDIUM");
    const u = await createWorkItem(alice, { title: "urgent thing", description: "", priority: "URGENT" }, null);
    expect(u.item.priority).toBe("URGENT");
    const high = await listWorkItems(alice, { limit: 100, priority: "HIGH" });
    expect(high.items).toHaveLength(0);
    const urgent = await listWorkItems(alice, { limit: 100, priority: "URGENT" });
    expect(urgent.items.map((i) => i.id)).toEqual([u.item.id]);
  });

  it("records priority changes transactionally", async () => {
    const c = await createWorkItem(alice, { title: "T", description: "" }, null);
    const updated = await updateWorkItem(alice, c.item.id, { version: 1, priority: "HIGH" });
    expect(updated.version).toBe(2);
    expect(updated.priority).toBe("HIGH");
    const events = await getActivity(alice, c.item.id);
    expect(events.find((e) => e.type === "FIELD_UPDATED")?.changes).toMatchObject({
      priority: { from: "MEDIUM", to: "HIGH" },
    });
  });

  it("treats team+priority as part of the idempotency fingerprint", async () => {
    const team = await createTeam(alice, { name: "Platform" });
    const base = { title: "F", description: "", priority: "HIGH" as const };
    await createWorkItem(alice, base, "fp-key");
    // Same key, different priority -> conflict, not a replay.
    await expect(
      createWorkItem(alice, { ...base, priority: "LOW" }, "fp-key"),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSE" });
    // Same key, different team -> conflict as well.
    await expect(createWorkItem(alice, { ...base, teamId: team.id }, "fp-key")).rejects.toMatchObject({
      code: "IDEMPOTENCY_KEY_REUSE",
    });
  });
});
