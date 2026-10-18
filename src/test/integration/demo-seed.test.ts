import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { addMember, createTeam } from "@/modules/teams";
import type { SessionUser } from "@/lib/auth";

// Mirrors the reconciliation logic in prisma/demo-seed.ts without touching
// production: the point of these tests is that the dataset is a pure function
// of its stable identifiers, so re-running converges instead of duplicating.

const DEMO_DOMAIN = "@demo.opsflow.invalid";
const KEY = "demo-seed:v1:test-01";

async function resetDb() {
  await db.activityEvent.deleteMany();
  await db.idempotencyRecord.deleteMany();
  await db.session.deleteMany();
  await db.workItem.deleteMany();
  await db.teamMembership.deleteMany();
  await db.team.deleteMany();
  await db.user.deleteMany();
}

async function demoUser(email: string): Promise<SessionUser> {
  const u = await db.user.upsert({
    where: { email },
    update: {},
    create: { email, name: email.split("@")[0], passwordHash: await hashPassword("OpsFlowDemo2024!"), role: "USER" },
  });
  return { id: u.id, email: u.email, name: u.name, role: u.role };
}

async function seedTeamOnce(id: string, name: string, leadEmail: string, memberEmails: string[]) {
  const existing = await db.team.findUnique({ where: { id } });
  const teamId = existing ? existing.id : (await db.team.create({ data: { id, name } })).id;
  const lead = await demoUser(leadEmail);
  const leadRow = await db.teamMembership.findUnique({ where: { userId_teamId: { userId: lead.id, teamId } } });
  if (!leadRow) await db.teamMembership.create({ data: { userId: lead.id, teamId, role: "LEAD" } });
  for (const email of memberEmails) {
    const m = await demoUser(email);
    const row = await db.teamMembership.findUnique({ where: { userId_teamId: { userId: m.id, teamId } } });
    if (!row) await db.teamMembership.create({ data: { userId: m.id, teamId, role: "MEMBER" } });
  }
  return teamId;
}

let realUser: SessionUser;

beforeEach(async () => {
  if (!process.env.DATABASE_URL?.includes("test")) {
    throw new Error("Refusing to run integration tests against a non-test database.");
  }
  await resetDb();
  realUser = await demoUser("real.person@not-demo.example");
});

describe("demo dataset reconciliation", () => {
  it("is idempotent: seeding twice creates no duplicates", async () => {
    const id = "demo-team-test";
    await seedTeamOnce(id, "Product & Engineering", `lead${DEMO_DOMAIN}`, [`m1${DEMO_DOMAIN}`]);
    await seedTeamOnce(id, "Product & Engineering", `lead${DEMO_DOMAIN}`, [`m1${DEMO_DOMAIN}`]);

    expect(await db.team.count({ where: { id } })).toBe(1);
    expect(await db.user.count({ where: { email: { endsWith: DEMO_DOMAIN } } })).toBe(2);
    expect(await db.teamMembership.count({ where: { teamId: id } })).toBe(2);
  });

  it("gives every demo user the global USER role, never ADMIN", async () => {
    await seedTeamOnce("demo-team-a", "A", `a${DEMO_DOMAIN}`, []);
    const demoUsers = await db.user.findMany({ where: { email: { endsWith: DEMO_DOMAIN } } });
    expect(demoUsers.length).toBeGreaterThan(0);
    for (const u of demoUsers) expect(u.role).toBe("USER");
  });

  it("assigns exactly one LEAD and the rest MEMBER per team", async () => {
    const id = await seedTeamOnce("demo-team-b", "B", `lead${DEMO_DOMAIN}`, [`a${DEMO_DOMAIN}`, `b${DEMO_DOMAIN}`]);
    const rows = await db.teamMembership.findMany({ where: { teamId: id } });
    expect(rows.filter((r) => r.role === "LEAD")).toHaveLength(1);
    expect(rows.filter((r) => r.role === "MEMBER")).toHaveLength(2);
  });

  it("leaves unrelated (non-demo) users untouched", async () => {
    await seedTeamOnce("demo-team-c", "C", `c${DEMO_DOMAIN}`, []);
    const real = await db.user.findUniqueOrThrow({ where: { email: "real.person@not-demo.example" } });
    expect(real.role).toBe("USER");
    expect(real.email).toBe("real.person@not-demo.example");
    expect(await db.teamMembership.count({ where: { userId: real.id } })).toBe(0);
  });

  it("does not overwrite an existing user's password when reconciling", async () => {
    const custom = await hashPassword("a-completely-different-password");
    await db.user.create({ data: { email: `keep${DEMO_DOMAIN}`, name: "Keep", passwordHash: custom, role: "USER" } });
    const before = await db.user.findUniqueOrThrow({ where: { email: `keep${DEMO_DOMAIN}` } });
    expect(before.passwordHash).toBe(custom);
  });
});

describe("demo access boundary", () => {
  it("does not let a plain member escalate to LEAD or add members", async () => {
    const teamId = await seedTeamOnce("demo-team-d", "D", `lead${DEMO_DOMAIN}`, []);
    const member = await demoUser(`member${DEMO_DOMAIN}`);
    await db.teamMembership.create({ data: { userId: member.id, teamId, role: "MEMBER" } });

    await expect(addMember(member, teamId, { userId: member.id, role: "LEAD" })).rejects.toMatchObject({
      status: 403,
      code: "FORBIDDEN",
    });
    await expect(addMember(member, teamId, { userId: realUser.id, role: "MEMBER" })).rejects.toMatchObject({
      status: 403,
      code: "FORBIDDEN",
    });
  });

  it("lets a team LEAD manage the roster but still not grant global ADMIN", async () => {
    const teamId = await seedTeamOnce("demo-team-e", "E", `lead${DEMO_DOMAIN}`, []);
    const lead = await demoUser(`lead${DEMO_DOMAIN}`);
    const target = await demoUser(`target${DEMO_DOMAIN}`);
    const m = await addMember(lead, teamId, { userId: target.id, role: "MEMBER" });
    expect(m.role).toBe("MEMBER");
    const stillUser = await db.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(stillUser.role).toBe("USER");
  });

  it("a team creator becomes LEAD without gaining global ADMIN", async () => {
    const creator = await demoUser(`creator${DEMO_DOMAIN}`);
    const t = await createTeam(creator, { name: "Created In Test" });
    expect(t.myRole).toBe("LEAD");
    const after = await db.user.findUniqueOrThrow({ where: { id: creator.id } });
    expect(after.role).toBe("USER");
  });
});
