// Per-player PvP ammo store — in-memory, starts empty, filled by pickups.

import { test } from "node:test";
import assert from "node:assert/strict";

const { PVP_STARTING_AMMO, resetPvpAmmo, addPvpAmmo, getPvpAmmo, hasPvpAmmo, spendPvpAmmo, onPvpAmmoChange } =
  await import("../js/pvpAmmo.js?v=20260530a");

test("players start empty (scavenge model)", () => {
  assert.equal(PVP_STARTING_AMMO, 0);
  resetPvpAmmo(2);
  assert.equal(getPvpAmmo(0), 0);
  assert.equal(getPvpAmmo(1), 0);
  assert.equal(hasPvpAmmo(0), false);
});

test("addPvpAmmo fills one player's pool only", () => {
  resetPvpAmmo(2);
  addPvpAmmo(0, 10);
  assert.equal(getPvpAmmo(0), 10);
  assert.equal(getPvpAmmo(1), 0, "P2 pool untouched");
  assert.equal(hasPvpAmmo(0), true);
});

test("addPvpAmmo ignores non-positive amounts and out-of-range indices", () => {
  resetPvpAmmo(2);
  addPvpAmmo(0, 0);
  addPvpAmmo(0, -5);
  addPvpAmmo(9, 10);
  assert.equal(getPvpAmmo(0), 0);
});

test("spend decrements only that player's pool, fails when empty", () => {
  resetPvpAmmo(2);
  addPvpAmmo(0, 2);
  assert.equal(spendPvpAmmo(0), true);
  assert.equal(spendPvpAmmo(0), true);
  assert.equal(getPvpAmmo(0), 0);
  assert.equal(spendPvpAmmo(0), false, "no-op when empty");
  assert.equal(getPvpAmmo(1), 0, "P2 untouched");
});

test("change listeners fire on reset, add and spend", () => {
  let n = 0;
  const off = onPvpAmmoChange(() => n++);
  resetPvpAmmo(2);
  addPvpAmmo(0, 3);
  spendPvpAmmo(0);
  off();
  addPvpAmmo(0, 1); // after unsubscribe
  assert.ok(n >= 3);
});
