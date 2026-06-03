import { test } from "node:test";
import assert from "node:assert/strict";
import { signToken, verifyToken, assertStrongSecret, MIN_SECRET_BYTES } from "../server/jwt.js";

const secret = "test-secret";

test("assertStrongSecret rejects a short secret but allows >=32 bytes or unset", () => {
  assert.throws(() => assertStrongSecret("short"), /too weak/);
  assert.throws(() => assertStrongSecret("a".repeat(MIN_SECRET_BYTES - 1)), /too weak/);
  assert.doesNotThrow(() => assertStrongSecret("a".repeat(MIN_SECRET_BYTES)));
  // A missing/empty secret is fine — that just leaves auth disabled.
  assert.doesNotThrow(() => assertStrongSecret(undefined));
  assert.doesNotThrow(() => assertStrongSecret(""));
});

test("sign/verify round-trip preserves the payload + stamps iat/exp", () => {
  const token = signToken({ sub: "usr_1" }, { secret });
  const payload = verifyToken(token, { secret });
  assert.ok(payload);
  assert.equal(payload.sub, "usr_1");
  assert.ok(payload.iat > 0);
  assert.ok(payload.exp > payload.iat);
});

test("a token signed with another secret is rejected", () => {
  const token = signToken({ sub: "x" }, { secret });
  assert.equal(verifyToken(token, { secret: "other-secret" }), null);
});

test("a tampered payload is rejected (signature no longer matches)", () => {
  const token = signToken({ sub: "x" }, { secret });
  const [h, , s] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ sub: "admin", exp: 9999999999 })).toString("base64url");
  assert.equal(verifyToken(`${h}.${forged}.${s}`, { secret }), null);
});

test("an expired token is rejected; a still-valid one passes", () => {
  const now = 1_000_000_000_000;
  const token = signToken({ sub: "x" }, { secret, ttlSeconds: 10, now });
  assert.ok(verifyToken(token, { secret, now: now + 5_000 }));
  assert.equal(verifyToken(token, { secret, now: now + 11_000 }), null);
});

test("malformed tokens are rejected, not thrown", () => {
  assert.equal(verifyToken("not.a.jwt", { secret }), null);
  assert.equal(verifyToken("only-one-part", { secret }), null);
  assert.equal(verifyToken("", { secret }), null);
  assert.equal(verifyToken(null, { secret }), null);
});
