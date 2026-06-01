// Password hashing with scrypt + a per-user random salt. The stored value
// is `salt$hash` (both base64). Verification is constant-time via
// timingSafeEqual so a wrong password can't be distinguished by timing.
//
// scrypt is memory-hard and ships in node:crypto — no dependency. The
// callback form is promisified so the route handlers can `await` it.

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

const KEY_BYTES = 64;
const SALT_BYTES = 16;

export async function hashPassword(password) {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scryptAsync(String(password), salt, KEY_BYTES);
  return `${salt.toString("base64")}$${derived.toString("base64")}`;
}

export async function verifyPassword(password, stored) {
  if (typeof stored !== "string" || !stored.includes("$")) return false;
  const [saltB64, hashB64] = stored.split("$");
  let salt, expected;
  try {
    salt = Buffer.from(saltB64, "base64");
    expected = Buffer.from(hashB64, "base64");
  } catch { return false; }
  if (!salt.length || !expected.length) return false;
  const derived = await scryptAsync(String(password), salt, expected.length);
  // Lengths always match here (we derive `expected.length` bytes), but guard
  // anyway — timingSafeEqual throws on a length mismatch.
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}
