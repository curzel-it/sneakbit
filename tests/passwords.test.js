import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "../server/passwords.js";
import { scrypt, randomBytes } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

test("new hashes carry the scrypt cost params and verify", async () => {
  const stored = await hashPassword("hunter2pw");
  assert.match(stored, /^scrypt\$16384\$8\$1\$/);
  assert.equal(await verifyPassword("hunter2pw", stored), true);
  assert.equal(await verifyPassword("wrong", stored), false);
});

test("a legacy salt$hash (no cost params) still verifies", async () => {
  // Reproduce the old on-disk format: salt$hash with node scrypt defaults.
  const salt = randomBytes(16);
  const derived = await scryptAsync("legacypw", salt, 64);
  const legacy = `${salt.toString("base64")}$${derived.toString("base64")}`;
  assert.equal(await verifyPassword("legacypw", legacy), true);
  assert.equal(await verifyPassword("nope", legacy), false);
});

test("a stored hash with absurd cost params is rejected, not run", async () => {
  // N must be a power of two within bounds — a corrupted/huge value fails
  // cleanly instead of driving scrypt to allocate.
  const bad = `scrypt$99999999$8$1$${Buffer.from("salt").toString("base64")}$${Buffer.from("hash").toString("base64")}`;
  assert.equal(await verifyPassword("x", bad), false);
});

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
