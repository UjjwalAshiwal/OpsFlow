import { beforeEach, describe, expect, it } from "vitest";
import { authenticateUser } from "@/lib/auth";
import type { SessionUser } from "@/lib/auth";
import { createWorkItem, getWorkItemStats, transitionWorkItem } from "@/modules/work-items/service";
import { assertTestDatabase, makeUser, resetDb } from "./helpers";

// Real PostgreSQL. Run with DATABASE_URL pointed at the isolated test database.
// NOTE: every file in this directory shares the one test database, so files
// run sequentially (fileParallelism: false in vitest.config.mts).

let alice: SessionUser;
let bob: SessionUser;

beforeEach(async () => {
  await assertTestDatabase();
  await resetDb();
  alice = await makeUser("alice@t.io");
  bob = await makeUser("bob@t.io");
});

describe("status stats aggregation", () => {
  it("returns zeros on an empty workspace", async () => {
    expect(await getWorkItemStats(alice)).toEqual({
      counts: { OPEN: 0, IN_PROGRESS: 0, REVIEW: 0, DONE: 0, CANCELLED: 0 },
      total: 0,
    });
  });

  it("counts every status from the database, not from fetched rows", async () => {
    const a = await createWorkItem(alice, { title: "A", description: "" }, null);
    const b = await createWorkItem(alice, { title: "B", description: "", assigneeId: bob.id }, null);
    const c = await createWorkItem(alice, { title: "C", description: "" }, null);
    await transitionWorkItem(alice, b.item.id, { version: 1, to: "IN_PROGRESS" });
    await transitionWorkItem(alice, c.item.id, { version: 1, to: "CANCELLED" });
    void a;
    const stats = await getWorkItemStats(bob);
    expect(stats).toEqual({
      counts: { OPEN: 1, IN_PROGRESS: 1, REVIEW: 0, DONE: 0, CANCELLED: 1 },
      total: 3,
    });
  });
});

describe("authentication behavior", () => {
  it("rejects unknown emails and wrong passwords identically", async () => {
    await expect(authenticateUser("nobody@t.io", "password123", "ip-1")).rejects.toMatchObject({
      status: 401,
      code: "INVALID_CREDENTIALS",
    });
    await expect(authenticateUser(alice.email, "wrongpassword", "ip-1")).rejects.toMatchObject({
      status: 401,
      code: "INVALID_CREDENTIALS",
    });
  });

  it("spends a password-hash verification even for unknown emails (no timing oracle)", async () => {
    const start = Date.now();
    await expect(authenticateUser("ghost@t.io", "password123", "ip-2")).rejects.toThrow();
    // scrypt with the configured cost floor consistently exceeds this; a skipped
    // hash would return in ~1ms. Generous bound to avoid flakiness.
    expect(Date.now() - start).toBeGreaterThanOrEqual(10);
  });

  it("authenticates valid credentials and returns the session user", async () => {
    const user = await authenticateUser(alice.email, "password123", "ip-3");
    expect(user).toMatchObject({ id: alice.id, email: alice.email, role: "USER" });
  });

  it("rate-limits repeated failures and resets on success", async () => {
    for (let i = 0; i < 5; i++) {
      await expect(authenticateUser(alice.email, "nope", "ip-4")).rejects.toMatchObject({
        code: "INVALID_CREDENTIALS",
      });
    }
    const blocked = await authenticateUser(alice.email, "nope", "ip-4").catch((e) => e);
    expect(blocked).toMatchObject({ status: 429, code: "RATE_LIMITED" });

    // A different client is unaffected.
    await expect(authenticateUser(alice.email, "nope", "ip-5")).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
    });

    // Success below the cap clears the counter…
    for (let i = 0; i < 4; i++) {
      await expect(authenticateUser(alice.email, "nope", "ip-6")).rejects.toMatchObject({
        code: "INVALID_CREDENTIALS",
      });
    }
    await expect(authenticateUser(alice.email, "password123", "ip-6")).resolves.toMatchObject({
      id: alice.id,
    });

    // …but once the cap is hit, even the correct password waits out the window.
    for (let i = 0; i < 5; i++) {
      await expect(authenticateUser(alice.email, "nope", "ip-7")).rejects.toMatchObject({
        code: "INVALID_CREDENTIALS",
      });
    }
    await expect(authenticateUser(alice.email, "password123", "ip-7")).rejects.toMatchObject({
      status: 429,
      code: "RATE_LIMITED",
    });
  });
});
