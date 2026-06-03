// Stateless session tokens: HS256 JWTs signed with an HMAC over JWT_SECRET.
// No dependency — base64url + node:crypto. Sessions are bearer tokens the
// client stores in localStorage and sends as `Authorization: Bearer <jwt>`.
//
// Stateless = there is no server-side session table and no revocation. A
// token is valid until its `exp`. That's an accepted trade-off for a game
// (see the spec's security notes); if revocation is ever needed, switch to
// a short access token + a server-side refresh/denylist.

import { createHmac, timingSafeEqual } from "node:crypto";

// 30 days. Long-lived on purpose — re-prompting a player for their password
// every session would be hostile for an optional, additive feature.
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 30;

// Tokens are non-revocable and live 30 days, so a weak secret means anyone who
// captures one token can brute-force the secret offline and then mint tokens
// for any account. 32 bytes is the floor for an HMAC-SHA256 key.
export const MIN_SECRET_BYTES = 32;

// Fail fast at boot on a misconfigured (crackable) secret. A *missing* secret
// is fine — that just leaves auth disabled (offline-first); only a present-but-
// too-short secret throws, so the operator must fix it or unset it.
export function assertStrongSecret(secret = process.env.JWT_SECRET) {
  if (!secret) return;
  if (Buffer.byteLength(String(secret), "utf8") < MIN_SECRET_BYTES) {
    throw new Error(
      `JWT_SECRET is too weak: need >= ${MIN_SECRET_BYTES} bytes (got ${Buffer.byteLength(String(secret), "utf8")})`
    );
  }
}

function b64url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64urlJson(obj) {
  return b64url(JSON.stringify(obj));
}

function fromB64url(str) {
  return Buffer.from(String(str).replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

export function signToken(payload, {
  ttlSeconds = DEFAULT_TTL_SECONDS,
  secret = process.env.JWT_SECRET,
  now = Date.now(),
} = {}) {
  if (!secret) throw new Error("JWT_SECRET not configured");
  const iat = Math.floor(now / 1000);
  const body = { ...payload, iat, exp: iat + ttlSeconds };
  const header = { alg: "HS256", typ: "JWT" };
  const signingInput = `${b64urlJson(header)}.${b64urlJson(body)}`;
  const sig = b64url(createHmac("sha256", secret).update(signingInput).digest());
  return `${signingInput}.${sig}`;
}

// Returns the decoded payload, or null for any failure (bad shape, wrong
// signature, expired). Callers treat null as "not authenticated" — they
// never branch on *why* it failed.
export function verifyToken(token, {
  secret = process.env.JWT_SECRET,
  now = Date.now(),
} = {}) {
  if (!secret || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  const signingInput = `${h}.${p}`;
  const expected = createHmac("sha256", secret).update(signingInput).digest();
  let provided;
  try { provided = fromB64url(s); } catch { return null; }
  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(provided, expected)) return null;
  let payload;
  try { payload = JSON.parse(fromB64url(p).toString("utf8")); } catch { return null; }
  if (typeof payload.exp === "number" && Math.floor(now / 1000) >= payload.exp) return null;
  return payload;
}
