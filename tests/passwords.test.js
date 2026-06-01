import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "../server/passwords.js";

test("hash then verify the same password succeeds", async () => {
  const stored = await hashPassword("hunter2pw");
  assert.ok(stored.includes("$"));
  assert.equal(await verifyPassword("hunter2pw", stored), true);
});

test("a wrong password fails verification", async () => {
  const stored = await hashPassword("hunter2pw");
  assert.equal(await verifyPassword("not-it", stored), false);
});

test("the same password hashes to different values (random salt)", async () => {
  const a = await hashPassword("same-password");
  const b = await hashPassword("same-password");
  assert.notEqual(a, b);
  assert.equal(await verifyPassword("same-password", a), true);
  assert.equal(await verifyPassword("same-password", b), true);
});

test("a malformed stored hash fails cleanly", async () => {
  assert.equal(await verifyPassword("x", "garbage-no-separator"), false);
  assert.equal(await verifyPassword("x", ""), false);
  assert.equal(await verifyPassword("x", "$"), false);
});
