import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, createUser, updateUser } from "../server/db.js";
import { signToken } from "../server/jwt.js";
import { authenticateUser, bearerToken } from "../server/bearerAuth.js";

const secret = "test-secret";

function reqWith(token) {
  return { headers: token ? { authorization: `Bearer ${token}` } : {} };
}

test("bearerToken parses the Authorization header (case-insensitive), else null", () => {
  assert.equal(bearerToken({ headers: { authorization: "Bearer abc" } }), "abc");
  assert.equal(bearerToken({ headers: { authorization: "bearer abc" } }), "abc");
  assert.equal(bearerToken({ headers: { authorization: "Basic abc" } }), null);
  assert.equal(bearerToken({ headers: {} }), null);
  assert.equal(bearerToken({ headers: { authorization: "Bearer " } }), null);
});

// Tokens carry a real `exp` checked against the wall clock, so timestamps in
// these tests are anchored to a recent `now` (not epoch 0) to stay unexpired.
const NOW = Date.now();

test("authenticateUser resolves a valid token to the user", () => {
  const db = openDb(":memory:");
  const user = createUser(db, { id: "usr_1", email: "a@b.com", passwordHash: "h", now: NOW });
  const token = signToken({ sub: user.id }, { secret, now: NOW });
  const got = authenticateUser(reqWith(token), { db, secret });
  assert.equal(got?.id, "usr_1");
});

test("a token issued before the last password change is rejected", () => {
  const db = openDb(":memory:");
  const user = createUser(db, { id: "usr_1", email: "a@b.com", passwordHash: "h", now: NOW });
  const stale = signToken({ sub: user.id }, { secret, now: NOW });
  assert.ok(authenticateUser(reqWith(stale), { db, secret }), "valid before the change");

  // Password changes 10s later → every token with an earlier iat is retired.
  updateUser(db, user.id, { passwordHash: "h2", now: NOW + 10_000 });
  assert.equal(authenticateUser(reqWith(stale), { db, secret }), null, "retired after the change");

  // A token minted at/after the change still authorizes.
  const fresh = signToken({ sub: user.id }, { secret, now: NOW + 10_000 });
  assert.ok(authenticateUser(reqWith(fresh), { db, secret }), "post-change token survives");
});

test("a deleted user's still-signed token no longer authenticates", () => {
  const db = openDb(":memory:");
  const user = createUser(db, { id: "usr_1", email: "a@b.com", passwordHash: "h", now: NOW });
  const token = signToken({ sub: user.id }, { secret, now: NOW });
  assert.ok(authenticateUser(reqWith(token), { db, secret }));
  db.prepare("DELETE FROM users WHERE id = ?").run(user.id);
  assert.equal(authenticateUser(reqWith(token), { db, secret }), null);
});

test("missing / garbage tokens resolve to null without throwing", () => {
  const db = openDb(":memory:");
  assert.equal(authenticateUser(reqWith(null), { db, secret }), null);
  assert.equal(authenticateUser(reqWith("not.a.jwt"), { db, secret }), null);
});
