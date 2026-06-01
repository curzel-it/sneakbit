import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import {
  openDb, createUser, findUserByEmail, findUserById, updateUser,
  createPasswordReset, findPasswordReset, markPasswordResetUsed,
} from "../server/db.js";

const mem = () => openDb(":memory:");

test("migrations are idempotent across reopen of the same file", () => {
  const path = join(tmpdir(), `sb-db-${process.pid}-${Date.now()}.db`);
  try {
    const a = openDb(path);
    a.close();
    // Reopening re-runs migrate() against existing tables — must not throw.
    const b = openDb(path);
    const row = b.prepare("SELECT count(*) AS c FROM users").get();
    assert.equal(row.c, 0);
    b.close();
  } finally {
    try { rmSync(path); } catch { /* ignore */ }
  }
});

test("user create / read / update", () => {
  const db = mem();
  const u = createUser(db, { id: "usr_1", email: "a@b.com", passwordHash: "h", displayName: "Neo", now: 1000 });
  assert.equal(u.email, "a@b.com");
  assert.equal(u.email_verified, 0);
  assert.equal(findUserByEmail(db, "a@b.com").id, "usr_1");
  assert.equal(findUserById(db, "usr_1").display_name, "Neo");
  assert.equal(findUserByEmail(db, "missing@b.com"), null);

  const updated = updateUser(db, "usr_1", { displayName: "Trinity", now: 2000 });
  assert.equal(updated.display_name, "Trinity");
  assert.equal(updated.updated_at, 2000);
});

test("the email uniqueness constraint is enforced", () => {
  const db = mem();
  createUser(db, { id: "usr_1", email: "dup@b.com", passwordHash: "h", now: 1 });
  assert.throws(() => createUser(db, { id: "usr_2", email: "dup@b.com", passwordHash: "h", now: 2 }));
});

test("password reset row lifecycle: create / find / mark used", () => {
  const db = mem();
  createUser(db, { id: "usr_1", email: "a@b.com", passwordHash: "h", now: 1 });
  createPasswordReset(db, { tokenHash: "th", userId: "usr_1", expiresAt: 9999 });
  const row = findPasswordReset(db, "th");
  assert.equal(row.user_id, "usr_1");
  assert.equal(row.used_at, null);
  markPasswordResetUsed(db, "th", 123);
  assert.equal(findPasswordReset(db, "th").used_at, 123);
});
