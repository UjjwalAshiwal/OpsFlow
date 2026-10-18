import { db } from "../src/lib/db";
import { hashPassword } from "../src/lib/password";

// Development-only seed. Test accounts are clearly marked; no production secrets.
async function main() {
  const admin = await db.user.upsert({
    where: { email: "admin@newtonite.local" },
    update: {},
    create: {
      email: "admin@newtonite.local",
      passwordHash: await hashPassword("admin12345"),
      name: "Ada Admin",
      role: "ADMIN",
    },
  });
  const alice = await db.user.upsert({
    where: { email: "alice@newtonite.local" },
    update: {},
    create: {
      email: "alice@newtonite.local",
      passwordHash: await hashPassword("alice12345"),
      name: "Alice",
      role: "USER",
    },
  });
  const bob = await db.user.upsert({
    where: { email: "bob@newtonite.local" },
    update: {},
    create: {
      email: "bob@newtonite.local",
      passwordHash: await hashPassword("bob12345"),
      name: "Bob",
      role: "USER",
    },
  });

  // Teams and memberships always converge (outside the item gate below) so
  // existing databases gain them on re-seed. Alice leads Platform (bob is a
  // member); bob leads Field Ops.
  const platform = await db.team.upsert({
    where: { id: "seed-team-platform" },
    update: {},
    create: { id: "seed-team-platform", name: "Platform" },
  });
  const fieldOps = await db.team.upsert({
    where: { id: "seed-team-field-ops" },
    update: {},
    create: { id: "seed-team-field-ops", name: "Field Ops" },
  });
  for (const [userId, teamId, role] of [
    [alice.id, platform.id, "LEAD"],
    [bob.id, platform.id, "MEMBER"],
    [bob.id, fieldOps.id, "LEAD"],
  ] as const) {
    await db.teamMembership.upsert({
      where: { userId_teamId: { userId, teamId } },
      update: { role },
      create: { userId, teamId, role },
    });
  }

  const count = await db.workItem.count();
  if (count === 0) {
    const first = await db.workItem.create({
      data: {
        title: "Set up project board",
        description: "Create the initial set of work items for the team.",
        status: "IN_PROGRESS",
        priority: "HIGH",
        creatorId: alice.id,
        assigneeId: bob.id,
        teamId: platform.id,
      },
    });
    await db.activityEvent.create({
      data: { workItemId: first.id, actorId: alice.id, type: "CREATED", toStatus: "OPEN" },
    });
    await db.activityEvent.create({
      data: {
        workItemId: first.id,
        actorId: alice.id,
        type: "STATE_CHANGED",
        fromStatus: "OPEN",
        toStatus: "IN_PROGRESS",
      },
    });
    const second = await db.workItem.create({
      data: {
        title: "Write onboarding notes",
        description: "Document how to run the app locally.",
        status: "OPEN",
        creatorId: bob.id,
      },
    });
    await db.activityEvent.create({
      data: { workItemId: second.id, actorId: bob.id, type: "CREATED", toStatus: "OPEN" },
    });
  }

  console.log("Seeded:", { admin: admin.email, alice: alice.email, bob: bob.email });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
