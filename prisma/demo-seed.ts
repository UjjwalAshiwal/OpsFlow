import { randomBytes } from "node:crypto";
import { db } from "../src/lib/db";
import { hashPassword } from "../src/lib/password";
import { createWorkItem, transitionWorkItem } from "../src/modules/work-items/service";
import type { SessionUser } from "../src/lib/auth";

// Production demo-data seed for OpsFlow.
//
// Creates a realistic, self-consistent demo workspace so a visitor can explore
// teams, assignment, workflow, priorities and activity history immediately.
//
//   npm run db:seed:demo            (requires confirmation)
//   npm run db:seed:demo -- --force (also allowed on a localhost database)
//
// Safety properties:
//   * Refuses to run against localhost unless --force is passed.
//   * Requires explicit confirmation (--yes) before writing.
//   * Touches only records it owns: emails ending @demo.opsflow.invalid, the
//     two demo team ids, and work items carrying a "demo-seed-v1-" key.
//   * Never deletes, truncates, or rewrites anything outside that set.
//   * Idempotent: every record is reconciled by a stable identifier, so
//     re-running converges instead of duplicating.
//   * Creates no ADMIN. Demo users are always USER.
//   * Goes through createWorkItem/transitionWorkItem so workflow rules,
//     assignee eligibility and activity history are enforced by the domain
//     layer rather than by hand-written rows.

const DEMO_DOMAIN = "@demo.opsflow.invalid";
const KEY_PREFIX = "demo-seed-v1";
// Demo accounts are reachable through /api/auth/demo-login, which never needs a
// password. Each demo user therefore gets an unguessable random password so no
// demo credential is ever published in this repository.
function randomDemoPassword(): string {
  return randomBytes(32).toString("base64url");
}

const TEAM_A = { id: "demo-team-product-engineering", name: "Product & Engineering" };
const TEAM_B = { id: "demo-team-operations-cx", name: "Operations & Customer Success" };

// The identity offered by "Explore Demo": leads Team A and is a member of
// Team B so a visitor can see the whole demo workspace. Never ADMIN.
const DEMO_LOGIN_EMAIL = `olivia.carter${DEMO_DOMAIN}`;

type Spec = { email: string; name: string };

const USERS: Spec[] = [
  { email: `olivia.carter${DEMO_DOMAIN}`, name: "Olivia Carter" },
  { email: `ethan.brooks${DEMO_DOMAIN}`, name: "Ethan Brooks" },
  { email: `sophia.bennett${DEMO_DOMAIN}`, name: "Sophia Bennett" },
  { email: `liam.foster${DEMO_DOMAIN}`, name: "Liam Foster" },
  { email: `ava.mitchell${DEMO_DOMAIN}`, name: "Ava Mitchell" },
  { email: `noah.parker${DEMO_DOMAIN}`, name: "Noah Parker" },
  { email: `isabella.reed${DEMO_DOMAIN}`, name: "Isabella Reed" },
  { email: `mason.cooper${DEMO_DOMAIN}`, name: "Mason Cooper" },
  { email: `mia.sullivan${DEMO_DOMAIN}`, name: "Mia Sullivan" },
  { email: `lucas.morgan${DEMO_DOMAIN}`, name: "Lucas Morgan" },
  { email: `amelia.hayes${DEMO_DOMAIN}`, name: "Amelia Hayes" },
  { email: `james.turner${DEMO_DOMAIN}`, name: "James Turner" },
];

// Six per team: one LEAD, five MEMBER. Olivia is additionally a MEMBER of Team B.
const ROSTER: Record<string, { lead: string; members: string[] }> = {
  [TEAM_A.id]: {
    lead: `olivia.carter${DEMO_DOMAIN}`,
    members: [
      `ethan.brooks${DEMO_DOMAIN}`,
      `sophia.bennett${DEMO_DOMAIN}`,
      `liam.foster${DEMO_DOMAIN}`,
      `ava.mitchell${DEMO_DOMAIN}`,
      `noah.parker${DEMO_DOMAIN}`,
    ],
  },
  [TEAM_B.id]: {
    lead: `isabella.reed${DEMO_DOMAIN}`,
    members: [
      `mason.cooper${DEMO_DOMAIN}`,
      `mia.sullivan${DEMO_DOMAIN}`,
      `lucas.morgan${DEMO_DOMAIN}`,
      `amelia.hayes${DEMO_DOMAIN}`,
      `james.turner${DEMO_DOMAIN}`,
      `olivia.carter${DEMO_DOMAIN}`,
    ],
  },
};

type Item = {
  key: string;
  team: string;
  title: string;
  description: string;
  assignee?: string;
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  status: "OPEN" | "IN_PROGRESS" | "REVIEW" | "DONE" | "CANCELLED";
};

const a = (n: string) => `${n}${DEMO_DOMAIN}`;
const ITEMS: Item[] = [
  // ---- Product & Engineering
  { key: "pe-01", team: TEAM_A.id, title: "Implement workspace dashboard filters", description: "Add status, priority and assignee filters to the dashboard summary so leads can scope their view without leaving the page.", assignee: a("ethan.brooks"), priority: "HIGH", status: "IN_PROGRESS" },
  { key: "pe-02", team: TEAM_A.id, title: "Fix session expiration handling", description: "Sessions are not reliably invalidated after their expiry timestamp. Reproduce with a short TTL and confirm the expired row is reaped.", assignee: a("sophia.bennett"), priority: "URGENT", status: "IN_PROGRESS" },
  { key: "pe-03", team: TEAM_A.id, title: "Improve work-item search", description: "Search currently matches titles only. Extend it to descriptions and confirm result ordering stays deterministic.", assignee: a("liam.foster"), priority: "MEDIUM", status: "REVIEW" },
  { key: "pe-04", team: TEAM_A.id, title: "Review registration validation", description: "Audit the registration schema: password minimum, email normalisation, and duplicate handling on the unique index.", assignee: a("ava.mitchell"), priority: "HIGH", status: "REVIEW" },
  { key: "pe-05", team: TEAM_A.id, title: "Add pagination to the work-item list", description: "The list endpoint returns everything. Move to cursor pagination with a stable ordering key.", assignee: a("noah.parker"), priority: "MEDIUM", status: "DONE" },
  { key: "pe-06", team: TEAM_A.id, title: "Improve API error handling", description: "Standardise error payloads so every failure carries a stable code and no internal detail.", assignee: a("ethan.brooks"), priority: "HIGH", status: "DONE" },
  { key: "pe-07", team: TEAM_A.id, title: "Investigate a slow database query", description: "The dashboard aggregation scans the whole work-item table. Capture a plan and add the covering index.", assignee: a("liam.foster"), priority: "HIGH", status: "OPEN" },
  { key: "pe-08", team: TEAM_A.id, title: "Update onboarding documentation", description: "Refresh the quick-start so a new engineer can reach a running local environment from a clean clone.", priority: "LOW", status: "OPEN" },
  { key: "pe-09", team: TEAM_A.id, title: "Add integration tests for team membership", description: "Cover the last-lead guard and cross-team 404 behaviour against a real database.", assignee: a("sophia.bennett"), priority: "MEDIUM", status: "CANCELLED" },
  { key: "pe-10", team: TEAM_A.id, title: "Review the next production release", description: "Walk the release checklist: migrations applied, environment variables set, smoke tests green.", assignee: a("ava.mitchell"), priority: "URGENT", status: "OPEN" },
  { key: "pe-11", team: TEAM_A.id, title: "Deprecate the legacy cursor format", description: "Old clients still send v1 cursors. Emit v2 only and document the cut-over.", assignee: a("noah.parker"), priority: "LOW", status: "OPEN" },
  { key: "pe-12", team: TEAM_A.id, title: "Harden rate limiting on auth endpoints", description: "The in-memory limiter does not coordinate across instances. Move to a shared store.", assignee: a("ethan.brooks"), priority: "URGENT", status: "OPEN" },
  { key: "pe-13", team: TEAM_A.id, title: "Tighten assignee eligibility checks", description: "Ensure an item can never be assigned to a user who is not a member of its team.", assignee: a("liam.foster"), priority: "MEDIUM", status: "DONE" },

  // ---- Operations & Customer Success
  { key: "op-01", team: TEAM_B.id, title: "Prepare customer onboarding checklist", description: "Consolidate the scattered onboarding steps into one checklist a new customer can follow unaided.", assignee: a("mason.cooper"), priority: "HIGH", status: "IN_PROGRESS" },
  { key: "op-02", team: TEAM_B.id, title: "Review incoming support requests", description: "Triage the open queue by severity and route anything customer-blocking to the escalation path.", assignee: a("mia.sullivan"), priority: "URGENT", status: "IN_PROGRESS" },
  { key: "op-03", team: TEAM_B.id, title: "Document the escalation process", description: "Write down when and how an issue is escalated, who decides, and what the customer is told.", assignee: a("lucas.morgan"), priority: "HIGH", status: "REVIEW" },
  { key: "op-04", team: TEAM_B.id, title: "Update customer communication templates", description: "Refresh the notification templates so status updates match the new terminology.", assignee: a("amelia.hayes"), priority: "MEDIUM", status: "REVIEW" },
  { key: "op-05", team: TEAM_B.id, title: "Audit unresolved operational tasks", description: "Find long-running items with no recent activity and either close or re-scope them.", assignee: a("james.turner"), priority: "HIGH", status: "IN_PROGRESS" },
  { key: "op-06", team: TEAM_B.id, title: "Prepare the monthly operations report", description: "Pull throughput, backlog age and blocked counts for the leadership summary.", assignee: a("isabella.reed"), priority: "MEDIUM", status: "DONE" },
  { key: "op-07", team: TEAM_B.id, title: "Review service-level objectives", description: "Re-check the targets against the last quarter's actuals and propose revised thresholds.", assignee: a("mia.sullivan"), priority: "MEDIUM", status: "OPEN" },
  { key: "op-08", team: TEAM_B.id, title: "Organise the customer feedback backlog", description: "Cluster raw feedback into themes so product can prioritise with evidence.", assignee: a("mason.cooper"), priority: "LOW", status: "OPEN" },
  { key: "op-09", team: TEAM_B.id, title: "Validate the new user onboarding flow", description: "Walk a brand-new account through first value and note every point of friction.", assignee: a("amelia.hayes"), priority: "HIGH", status: "IN_PROGRESS" },
  { key: "op-10", team: TEAM_B.id, title: "Prepare the weekly team status report", description: "Summarise movement since the last report and flag anything at risk of slipping.", assignee: a("james.turner"), priority: "MEDIUM", status: "DONE" },
  { key: "op-11", team: TEAM_B.id, title: "Retire the shared support mailbox", description: "Move remaining traffic to the ticketing system and archive the old mailbox rules.", assignee: a("lucas.morgan"), priority: "LOW", status: "CANCELLED" },
  { key: "op-12", team: TEAM_B.id, title: "Publish the incident communication playbook", description: "Define who speaks externally during an incident and what is safe to share.", assignee: a("isabella.reed"), priority: "URGENT", status: "OPEN" },
  { key: "op-13", team: TEAM_B.id, title: "Reconcile duplicate customer records", description: "Two customers were onboarded twice during the migration. Merge the records carefully.", assignee: a("james.turner"), priority: "MEDIUM", status: "DONE" },
];

// Path from OPEN to the target status, using only edges the workflow allows.
const PATH: Record<Item["status"], Item["status"][]> = {
  OPEN: [],
  IN_PROGRESS: ["IN_PROGRESS"],
  REVIEW: ["IN_PROGRESS", "REVIEW"],
  DONE: ["IN_PROGRESS", "REVIEW", "DONE"],
  CANCELLED: ["CANCELLED"],
};

type Counts = { created: number; updated: number; unchanged: number };

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  const args = process.argv.slice(2);
  const isLocal = /localhost|127\.0\.0\.1/.test(url);
  const force = args.includes("--force");
  const confirmed = args.includes("--yes");

  // Production-safety guard: never write by accident.
  if (!url) throw new Error("DATABASE_URL is not set.");
  if (isLocal && !force) {
    throw new Error(
      "Refusing to seed a localhost database. This script targets the production demo dataset; pass --force only for a deliberate local trial.",
    );
  }
  if (!confirmed) {
    throw new Error(
      "Refusing to write without explicit confirmation. Re-run with --yes once you have checked the target database.",
    );
  }

  const host = (() => {
    try {
      return new URL(url).host;
    } catch {
      return "(unparseable)";
    }
  })();
  console.log(`Target database host: ${host}`);
  console.log(isLocal ? "WARNING: local database (--force was passed)." : "Confirmed: non-local target.");

  const zero = (): Counts => ({ created: 0, updated: 0, unchanged: 0 });
  const counts = { users: zero(), teams: zero(), memberships: zero(), items: zero() };

  // ---- Users (never ADMIN; upsert never touches an existing password)
  const passwordHash = await hashPassword(randomDemoPassword());
  const byEmail = new Map<string, { id: string; email: string; name: string; role: "USER" | "ADMIN" }>();
  for (const spec of USERS) {
    const existing = await db.user.findUnique({ where: { email: spec.email } });
    if (existing) {
      // Never overwrite credentials or role on an existing row.
      if (existing.name !== spec.name) {
        await db.user.update({ where: { id: existing.id }, data: { name: spec.name } });
        counts.users.updated++;
      } else {
        counts.users.unchanged++;
      }
      byEmail.set(spec.email, existing);
      continue;
    }
    const created = await db.user.create({
      data: { email: spec.email, name: spec.name, passwordHash, role: "USER" },
    });
    counts.users.created++;
    byEmail.set(spec.email, created);
  }

  // ---- Teams (stable ids give us reconciliation)
  // The id a spec refers to IS the row id, so no id lookup map is needed.
  for (const t of [TEAM_A, TEAM_B]) {
    const existing = await db.team.findUnique({ where: { id: t.id } });
    if (existing) {
      if (existing.name !== t.name) {
        await db.team.update({ where: { id: t.id }, data: { name: t.name } });
        counts.teams.updated++;
      } else {
        counts.teams.unchanged++;
      }
    } else {
      await db.team.create({ data: { id: t.id, name: t.name } });
      counts.teams.created++;
    }
  }

  // ---- Memberships
  for (const [teamId, r] of Object.entries(ROSTER)) {
    const rows = [
      { email: r.lead, role: "LEAD" as const },
      ...r.members.map((email) => ({ email, role: "MEMBER" as const })),
    ];
    for (const row of rows) {
      const user = byEmail.get(row.email)!;
      const existing = await db.teamMembership.findUnique({
        where: { userId_teamId: { userId: user.id, teamId } },
      });
      if (existing) {
        if (existing.role !== row.role) {
          await db.teamMembership.update({ where: { id: existing.id }, data: { role: row.role } });
          counts.memberships.updated++;
        } else {
          counts.memberships.unchanged++;
        }
      } else {
        await db.teamMembership.create({ data: { userId: user.id, teamId, role: row.role } });
        counts.memberships.created++;
      }
    }
  }

  // ---- Work items, via the domain services so invariants + history are real
  for (const item of ITEMS) {
    const key = `${KEY_PREFIX}-${item.key}`;
    const already = await db.workItem.findFirst({ where: { idempotencyKey: key } });
    if (already) {
      counts.items.unchanged++;
      continue;
    }
    const teamId = item.team;
    const teamLead = byEmail.get(ROSTER[item.team].lead)!;
    const actor: SessionUser = { id: teamLead.id, email: teamLead.email, name: teamLead.name, role: teamLead.role };
    const assignee = item.assignee ? byEmail.get(item.assignee) : undefined;
    if (item.assignee && !assignee) throw new Error(`Unknown assignee in seed spec: ${item.assignee}`);

    const { item: created } = await createWorkItem(
      actor,
      {
        title: item.title,
        description: item.description,
        teamId,
        assigneeId: assignee?.id ?? null,
        priority: item.priority,
      },
      key,
    );

    let current = created;
    for (const to of PATH[item.status]) {
      // OPEN -> IN_PROGRESS needs an assignee; it is set at creation above.
      current = await transitionWorkItem(actor, current.id, { version: current.version, to });
    }
    counts.items.created++;
  }

  const report = (label: string, c: Counts) =>
    console.log(`  ${label.padEnd(12)} created ${String(c.created).padStart(3)}  updated ${String(c.updated).padStart(3)}  unchanged ${String(c.unchanged).padStart(3)}`);

  console.log("\nDemo dataset reconciled:");
  report("users", counts.users);
  report("teams", counts.teams);
  report("memberships", counts.memberships);
  report("work items", counts.items);

  const admins = await db.user.count({ where: { role: "ADMIN", email: { endsWith: DEMO_DOMAIN } } });
  console.log(`\nSafety check — demo users with global ADMIN: ${admins} (must be 0)`);
  if (admins > 0) throw new Error("A demo user has ADMIN. Aborting.");
  console.log(`Demo login identity: ${DEMO_LOGIN_EMAIL}`);
}

main()
  .catch((e) => {
    console.error(`\nDemo seed failed: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());