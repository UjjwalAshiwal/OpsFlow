// Shared fixtures for the integration suite. Every file in this directory
// shares one PostgreSQL test database and runs sequentially
// (fileParallelism: false in vitest.config.mts), so each file resets the
// database in its own beforeEach and then builds the users it needs.

import { db } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import type { SessionUser } from "@/lib/auth";

/** Refuse to run against anything but the dedicated test database. */
export async function assertTestDatabase(): Promise<void> {
  if (!process.env.DATABASE_URL?.includes("test")) {
    throw new Error("Refusing to run integration tests against a non-test database.");
  }
}

/** Delete every row, children before parents so FK constraints stay satisfied. */
export async function resetDb(): Promise<void> {
  await db.activityEvent.deleteMany();
  await db.idempotencyRecord.deleteMany();
  await db.session.deleteMany();
  await db.workItem.deleteMany();
  await db.teamMembership.deleteMany();
  await db.team.deleteMany();
  await db.user.deleteMany();
}

export async function makeUser(email: string, role: "USER" | "ADMIN" = "USER"): Promise<SessionUser> {
  const u = await db.user.create({
    data: { email, passwordHash: await hashPassword("password123"), name: email.split("@")[0], role },
  });
  return { id: u.id, email: u.email, name: u.name, role: u.role };
}