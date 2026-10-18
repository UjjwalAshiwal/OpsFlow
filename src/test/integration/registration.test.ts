import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { authenticateUser, registerUser } from "@/lib/auth";
import { registerSchema } from "@/modules/work-items/schemas";
import { assertTestDatabase, resetDb } from "./helpers";

// Real PostgreSQL. Run with DATABASE_URL pointed at the isolated test database.
// NOTE: every file in this directory shares the one test database, so files
// run sequentially (fileParallelism: false in vitest.config.mts).

// Each test uses a distinct client key so the per-client registration rate
// limiter (5/hour) never bleeds between cases.
let clientSeq = 0;
function nextClient(): string {
  return `reg-test-client-${++clientSeq}`;
}

const GOOD = { name: "Ada Lovelace", email: "Ada@Example.COM", password: "correct horse battery" };

beforeEach(async () => {
  await assertTestDatabase();
  await resetDb();
});

describe("registration", () => {
  it("creates a user and returns the stored identity", async () => {
    const user = await registerUser(registerSchema.parse(GOOD), nextClient());
    expect(user).toMatchObject({ email: "ada@example.com", name: "Ada Lovelace", role: "USER" });
    const row = await db.user.findUnique({ where: { email: "ada@example.com" } });
    expect(row?.role).toBe("USER");
  });

  it("normalizes the email to lowercase", async () => {
    const user = await registerUser(registerSchema.parse(GOOD), nextClient());
    expect(user.email).toBe("ada@example.com");
  });

  it("stores a scrypt hash, never the plaintext password", async () => {
    await registerUser(registerSchema.parse(GOOD), nextClient());
    const row = await db.user.findUniqueOrThrow({ where: { email: "ada@example.com" } });
    expect(row.passwordHash).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]+$/);
    expect(row.passwordHash).not.toContain(GOOD.password);
  });

  it("issues a session token that validates back to the new user", async () => {
    const { createSession, getSessionUserByToken } = await import("@/lib/auth");
    const user = await registerUser(registerSchema.parse(GOOD), nextClient());
    const token = await createSession(user.id);
    await expect(getSessionUserByToken(token)).resolves.toMatchObject({ id: user.id, role: "USER" });
  });

  it("allows the new account to log in with the same password", async () => {
    await registerUser(registerSchema.parse(GOOD), nextClient());
    const user = await authenticateUser("ada@example.com", GOOD.password, "reg-login-client");
    expect(user).toMatchObject({ email: "ada@example.com", role: "USER" });
  });

  it("rejects a wrong password for a registered account", async () => {
    await registerUser(registerSchema.parse(GOOD), nextClient());
    await expect(
      authenticateUser("ada@example.com", "wrong password entirely", "reg-login-client-2"),
    ).rejects.toMatchObject({ status: 401, code: "INVALID_CREDENTIALS" });
  });

  it("rejects a duplicate email with 409", async () => {
    await registerUser(registerSchema.parse(GOOD), nextClient());
    await expect(registerUser(registerSchema.parse({ ...GOOD, name: "Impostor" }), nextClient())).rejects.toMatchObject({
      status: 409,
      code: "EMAIL_TAKEN",
    });
    expect(await db.user.count()).toBe(1);
  });

  it("treats a differently-cased duplicate email as a conflict", async () => {
    await registerUser(registerSchema.parse(GOOD), nextClient());
    await expect(
      registerUser(registerSchema.parse({ ...GOOD, email: "ADA@EXAMPLE.COM" }), nextClient()),
    ).rejects.toMatchObject({ status: 409, code: "EMAIL_TAKEN" });
  });

  it("rejects an invalid email", () => {
    expect(() => registerSchema.parse({ ...GOOD, email: "not-an-email" })).toThrow();
  });

  it("rejects a short password", () => {
    expect(() => registerSchema.parse({ ...GOOD, password: "short" })).toThrow();
  });

  it("rejects a blank name", () => {
    expect(() => registerSchema.parse({ ...GOOD, name: "   " })).toThrow();
  });

  it("rejects missing required fields", () => {
    expect(() => registerSchema.parse({ email: GOOD.email })).toThrow();
    expect(() => registerSchema.parse({ name: GOOD.name })).toThrow();
    expect(() => registerSchema.parse({})).toThrow();
  });

  // The escalation guard: the schema has no `role` key and the service never
  // reads one, so a client cannot mint an ADMIN through this endpoint.
  it("ignores a client-supplied role and creates only a USER", async () => {
    const body = { ...GOOD, role: "ADMIN" };
    const parsed = registerSchema.parse(body);
    expect(parsed).not.toHaveProperty("role");

    const user = await registerUser(parsed, nextClient());
    expect(user.role).toBe("USER");
    const row = await db.user.findUniqueOrThrow({ where: { email: "ada@example.com" } });
    expect(row.role).toBe("USER");
  });

  it("does not create any team membership", async () => {
    await registerUser(registerSchema.parse(GOOD), nextClient());
    expect(await db.team.count()).toBe(0);
    expect(await db.teamMembership.count()).toBe(0);
  });

  it("rate-limits repeated registrations from one client", async () => {
    const client = nextClient();
    for (let i = 0; i < 5; i++) {
      await registerUser(registerSchema.parse({ ...GOOD, email: `u${i}@example.com` }), client);
    }
    await expect(
      registerUser(registerSchema.parse({ ...GOOD, email: "u6@example.com" }), client),
    ).rejects.toMatchObject({ status: 429, code: "RATE_LIMITED" });
  });
});

describe("existing authentication still works", () => {
  it("still returns 401 for an unknown email and for a wrong password", async () => {
    await registerUser(registerSchema.parse(GOOD), nextClient());
    await expect(authenticateUser("nobody@example.com", GOOD.password, "reg-auth-client")).rejects.toMatchObject({
      status: 401,
    });
    await expect(authenticateUser("ada@example.com", "nope nope nope nope", "reg-auth-client-2")).rejects.toMatchObject({
      status: 401,
    });
  });

  it("keeps registering accounts from weakening role checks", async () => {
    // A registered USER must not be able to act on another user's team-less item.
    const ada = await registerUser(registerSchema.parse(GOOD), nextClient());
    const bob = await registerUser(registerSchema.parse({ ...GOOD, email: "bob@example.com" }), nextClient());
    expect(ada.role).toBe("USER");
    expect(bob.role).toBe("USER");
    expect(ada.id).not.toBe(bob.id);
  });
});