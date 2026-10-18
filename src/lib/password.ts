import { createHash, randomBytes, scrypt as nodeScrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(nodeScrypt);

// Cost parameters (key length, and Node's default N/r/p) live here, not in the
// stored hash — the format is `scrypt$salt$hash`. Raising them would therefore
// make every existing hash fail to verify and lock out every user; doing that
// safely needs a rehash-on-login path, which does not exist yet.
// One scrypt hash costs tens of milliseconds.
const KEYLEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, KEYLEN)) as Buffer;
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, salt, hash] = stored.split("$");
  if (algo !== "scrypt" || !salt || !hash) return false;
  const derived = (await scrypt(password, salt, KEYLEN)) as Buffer;
  const expected = Buffer.from(hash, "hex");
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
