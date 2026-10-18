import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { assertTestDatabase, makeUser, resetDb } from "./helpers";
import type { SessionUser } from "@/lib/auth";
import {
  createWorkItem,
  getActivity,
  listWorkItems,
  transitionWorkItem,
  updateWorkItem,
} from "@/modules/work-items/service";

// Runs against a REAL PostgreSQL database. Execute with:
//   DATABASE_URL="$TEST_DATABASE_URL" npx prisma db push && DATABASE_URL="$TEST_DATABASE_URL" npm run test:integration
// Mocked-DB tests cannot prove transaction or concurrency guarantees, so there are none here.

let alice: SessionUser;
let bob: SessionUser;
let outsider: SessionUser;

beforeAll(async () => {
  await assertTestDatabase();
});

beforeEach(async () => {
  await resetDb();
  alice = await makeUser("alice@t.io");
  bob = await makeUser("bob@t.io");
  outsider = await makeUser("mallory@t.io");
});

describe("workflow through the service", () => {
  it("walks the happy path OPEN -> IN_PROGRESS -> REVIEW -> DONE", async () => {
    const c = await createWorkItem(alice, { title: "T", description: "", assigneeId: bob.id }, null);
    let v = c.item.version;
    for (const to of ["IN_PROGRESS", "REVIEW", "DONE"] as const) {
      const r = await transitionWorkItem(alice, c.item.id, { version: v, to });
      expect(r.status).toBe(to);
      v = r.version;
    }
    expect(v).toBe(c.item.version + 3);
  });

  it("rejects illegal transitions and enforces the assignee precondition", async () => {
    const c = await createWorkItem(alice, { title: "T", description: "" }, null);
    await expect(transitionWorkItem(alice, c.item.id, { version: 1, to: "DONE" })).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
    });
    await expect(
      transitionWorkItem(alice, c.item.id, { version: 1, to: "IN_PROGRESS" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("records CREATED + STATE_CHANGED history newest-first", async () => {
    const c = await createWorkItem(alice, { title: "T", description: "", assigneeId: bob.id }, null);
    await transitionWorkItem(alice, c.item.id, { version: 1, to: "IN_PROGRESS" });
    const events = await getActivity(alice, c.item.id);
    expect(events.map((e) => e.type)).toEqual(["STATE_CHANGED", "CREATED"]);
    expect(events[0].fromStatus).toBe("OPEN");
    expect(events[0].toStatus).toBe("IN_PROGRESS");
  });
});

describe("optimistic concurrency", () => {
  it("rejects stale versions on update and transition", async () => {
    const c = await createWorkItem(alice, { title: "T", description: "" }, null);
    await updateWorkItem(alice, c.item.id, { version: 1, title: "T2" });
    await expect(updateWorkItem(alice, c.item.id, { version: 1, title: "T3" })).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
    });
    await expect(
      transitionWorkItem(alice, c.item.id, { version: 1, to: "CANCELLED" }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  });

  it("lets exactly one of two racing updates win, with a single history event", async () => {
    const c = await createWorkItem(alice, { title: "T", description: "" }, null);
    const results = await Promise.allSettled([
      updateWorkItem(alice, c.item.id, { version: 1, title: "racer A" }),
      updateWorkItem(alice, c.item.id, { version: 1, title: "racer B" }),
    ]);
    const won = results.filter((r) => r.status === "fulfilled");
    const lost = results.filter((r) => r.status === "rejected");
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect((lost[0] as PromiseRejectedResult).reason).toMatchObject({ code: "VERSION_CONFLICT" });
    const events = await getActivity(alice, c.item.id);
    expect(events.filter((e) => e.type === "FIELD_UPDATED")).toHaveLength(1);
  });

  it("writes no STATE_CHANGED event for a failed transition", async () => {
    const c = await createWorkItem(alice, { title: "T", description: "" }, null);
    const before = await getActivity(alice, c.item.id);
    await expect(transitionWorkItem(alice, c.item.id, { version: 1, to: "DONE" })).rejects.toThrow();
    const after = await getActivity(alice, c.item.id);
    expect(after).toHaveLength(before.length);
  });

  it("rolls back the item update when the history insert fails", async () => {
    // Same $transaction shape the service uses: business write + event insert.
    // A bogus actor id violates the FK, so the whole transaction must roll back.
    const c = await createWorkItem(alice, { title: "T", description: "" }, null);
    await expect(
      db.$transaction(async (tx) => {
        await tx.workItem.updateMany({ where: { id: c.item.id }, data: { title: "lost", version: { increment: 1 } } });
        await tx.activityEvent.create({
          data: { workItemId: c.item.id, actorId: "does-not-exist", type: "FIELD_UPDATED" },
        });
      }),
    ).rejects.toThrow();
    const item = await db.workItem.findUniqueOrThrow({ where: { id: c.item.id } });
    expect(item.title).toBe("T");
    expect(item.version).toBe(1);
  });
});

describe("idempotent creation", () => {
  it("replays same key + same payload without duplicating item or history", async () => {
    const input = { title: "Idem", description: "d", assigneeId: null };
    const first = await createWorkItem(alice, input, "key-1");
    expect(first).toMatchObject({ statusCode: 201, replayed: false });
    const second = await createWorkItem(alice, input, "key-1");
    expect(second).toMatchObject({ statusCode: 200, replayed: true });
    expect(second.item.id).toBe(first.item.id);
    expect(await db.workItem.count()).toBe(1);
    const events = await getActivity(alice, first.item.id);
    expect(events.filter((e) => e.type === "CREATED")).toHaveLength(1);
  });

  it("rejects same key + different payload", async () => {
    await createWorkItem(alice, { title: "A", description: "" }, "key-2");
    await expect(createWorkItem(alice, { title: "B", description: "" }, "key-2" )).rejects.toMatchObject({
      code: "IDEMPOTENCY_KEY_REUSE",
    });
  });

  it("creates at most one item under concurrent same-key races", async () => {
    const input = { title: "Race", description: "" };
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => createWorkItem(alice, input, "key-race")),
    );
    expect(await db.workItem.count()).toBe(1);
    for (const r of results) {
      if (r.status === "fulfilled") {
        expect([200, 201]).toContain(r.value.statusCode);
      } else {
        expect(r.reason).toMatchObject({ code: "IDEMPOTENCY_IN_PROGRESS" });
      }
    }
    // After the dust settles the key replays the single committed result.
    const replay = await createWorkItem(alice, input, "key-race");
    expect(replay.replayed).toBe(true);
  });

  it("leaves no completed result behind after a rolled-back create", async () => {
    const bad = { title: "Bad", description: "", assigneeId: "no-such-user" };
    await expect(createWorkItem(alice, bad, "key-fail")).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // Identical retry is a fresh attempt (not a replay, not a reuse conflict)...
    await expect(createWorkItem(alice, bad, "key-fail")).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // ...and a corrected request under the same key succeeds cleanly, once.
    const good = { title: "Bad", description: "", assigneeId: bob.id };
    const r = await createWorkItem(alice, good, "key-fail");
    expect(r).toMatchObject({ statusCode: 201, replayed: false });
    expect(await db.workItem.count()).toBe(1);
  });
});

describe("authorization", () => {
  it("forbids outsiders from mutating, lets creator/assignee act", async () => {
    const c = await createWorkItem(alice, { title: "T", description: "", assigneeId: bob.id }, null);
    await expect(updateWorkItem(outsider, c.item.id, { version: 1, title: "hijack" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      transitionWorkItem(outsider, c.item.id, { version: 1, to: "CANCELLED" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    // Assignee may drive the workflow.
    const moved = await transitionWorkItem(bob, c.item.id, { version: 1, to: "IN_PROGRESS" });
    expect(moved.status).toBe("IN_PROGRESS");
  });

  it("returns 404 with no existence leak for missing items", async () => {
    await expect(transitionWorkItem(alice, "no-such-id", { version: 1, to: "CANCELLED" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("search, filtering, pagination", () => {
  async function seedMany(n: number) {
    for (let i = 0; i < n; i++) {
      await createWorkItem(
        alice,
        {
          title: `Item ${String(i).padStart(2, "0")} needle`,
          description: i % 2 === 0 ? "even" : "odd",
          assigneeId: i % 3 === 0 ? bob.id : null,
        },
        null,
      );
    }
  }

  it("paginates a static dataset with no duplicates or omissions", async () => {
    await seedMany(25);
    const seen = new Set<string>();
    let cursor: string | undefined;
    let pages = 0;
    do {
      const res = await listWorkItems(alice, { limit: 10, ...(cursor ? { cursor } : {}) });
      pages++;
      for (const item of res.items) {
        expect(seen.has(item.id)).toBe(false);
        seen.add(item.id);
      }
      cursor = res.nextCursor ?? undefined;
      if (cursor === undefined) break;
    } while (pages < 10);
    expect(seen.size).toBe(25);
    expect(pages).toBe(3);
  });

  it("keeps ordering deterministic across repeated reads", async () => {
    await seedMany(15);
    const first = await listWorkItems(alice, { limit: 100 });
    const second = await listWorkItems(alice, { limit: 100 });
    expect(second.items.map((i) => i.id)).toEqual(first.items.map((i) => i.id));
  });

  it("applies status, assignee, and text filters in the database", async () => {
    await seedMany(12);
    const open = await listWorkItems(alice, { limit: 100, status: "OPEN" });
    expect(open.items.length).toBeGreaterThan(0);
    expect(open.items.every((i) => i.status === "OPEN")).toBe(true);

    const bobs = await listWorkItems(alice, { limit: 100, assigneeId: bob.id });
    expect(bobs.items.length).toBe(4); // i % 3 === 0 for i in 0..11
    expect(bobs.items.every((i) => i.assignee?.id === bob.id)).toBe(true);

    const needle = await listWorkItems(alice, { limit: 100, q: "item 03" });
    expect(needle.items.map((i) => i.title)).toEqual(["Item 03 needle"]);
  });

  it("rejects malformed cursors", async () => {
    await expect(listWorkItems(alice, { limit: 10, cursor: "garbage!!" })).rejects.toMatchObject({
      code: "INVALID_CURSOR",
    });
  });
});
