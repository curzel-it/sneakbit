// Password hashing with scrypt + a per-user random salt. The stored value is
// `scrypt$N$r$p$salt$hash` (salt+hash base64) — the cost parameters travel
// WITH the hash so the work factor can be raised later without breaking every
// existing password. Verification is constant-time via timingSafeEqual.
//
// Legacy hashes written before this change were bare `salt$hash` derived with
// node's scrypt defaults; verifyPassword still accepts them so existing
// accounts keep working (they re-hash to the new format on next password set).
//
// scrypt is memory-hard and ships in node:crypto — no dependency. The
// callback form is promisified so the route handlers can `await` it.

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

const KEY_BYTES = 64;
const SALT_BYTES = 16;
// Current cost. These match node's scrypt defaults today, so a legacy hash
// verifies identically under the default branch below.
const N = 16384;
const R = 8;
const P = 1;
// scrypt's working set is ~128 * N * r bytes (~16 MB here). node's default
// maxmem (32 MB) covers it, but set a generous ceiling so a future N bump
// doesn't start throwing — and so a (server-written) stored param set verifies.
const MAXMEM = 256 * 1024 * 1024;

export async function hashPassword(password) {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scryptAsync(String(password), salt, KEY_BYTES, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${derived.toString("base64")}`;
}

export async function verifyPassword(password, stored) {
  if (typeof stored !== "string" || !stored.includes("$")) return false;
  const parts = stored.split("$");
  let n = N, r = R, p = P, saltB64, hashB64;
  if (parts.length === 6 && parts[0] === "scrypt") {
    n = Number(parts[1]); r = Number(parts[2]); p = Number(parts[3]);
    saltB64 = parts[4]; hashB64 = parts[5];
    // Sane bounds so a corrupted row can't drive scrypt to OOM.
    if (![n, r, p].every(Number.isInteger) || n < 2 || (n & (n - 1)) !== 0 || n > (1 << 22) || r < 1 || r > 64 || p < 1 || p > 16) {
      return false;
    }
  } else if (parts.length === 2) {
    [saltB64, hashB64] = parts; // legacy salt$hash, node scrypt defaults
  } else {
    return false;
  }
  let salt, expected;
  try {
    salt = Buffer.from(saltB64, "base64");
    expected = Buffer.from(hashB64, "base64");
  } catch { return false; }
  if (!salt.length || !expected.length) return false;
  let derived;
  try {
    derived = await scryptAsync(String(password), salt, expected.length, { N: n, r, p, maxmem: MAXMEM });
  } catch { return false; }
  // Lengths always match here (we derive `expected.length` bytes), but guard
  // anyway — timingSafeEqual throws on a length mismatch.
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}
