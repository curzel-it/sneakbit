// Per-player PvP ammo store — in-memory, reset per match.

import { test } from "node:test";
import assert from "node:assert/strict";

const { PVP_STARTING_AMMO, resetPvpAmmo, getPvpAmmo, hasPvpAmmo, spendPvpAmmo, onPvpAmmoChange } =
  await import("../js/pvpAmmo.js?v=20260530a");

test("resetPvpAmmo seeds only the active players", () => {
  resetPvpAmmo(2);
  assert.equal(getPvpAmmo(0), PVP_STARTING_AMMO);
  assert.equal(getPvpAmmo(1), PVP_STARTING_AMMO);
  assert.equal(getPvpAmmo(2), 0);
  assert.equal(getPvpAmmo(3), 0);
});

test("spend decrements only that player's pool", () => {
  resetPvpAmmo(2);
  assert.equal(spendPvpAmmo(0), true);
  assert.equal(getPvpAmmo(0), PVP_STARTING_AMMO - 1);
  assert.equal(getPvpAmmo(1), PVP_STARTING_AMMO, "P2 pool untouched");
});

test("spend fails (and is a no-op) when empty", () => {
  resetPvpAmmo(4);
  for (let i = 0; i < PVP_STARTING_AMMO; i++) assert.equal(spendPvpAmmo(2), true);
  assert.equal(getPvpAmmo(2), 0);
  assert.equal(hasPvpAmmo(2), false);
  assert.equal(spendPvpAmmo(2), false);
  assert.equal(getPvpAmmo(2), 0);
});

test("a player not in the match has no ammo", () => {
  resetPvpAmmo(2);
  assert.equal(hasPvpAmmo(3), false);
  assert.equal(spendPvpAmmo(3), false);
});

test("change listeners fire on reset and spend", () => {
  let n = 0;
  const off = onPvpAmmoChange(() => n++);
  resetPvpAmmo(2);
  spendPvpAmmo(0);
  off();
  resetPvpAmmo(2); // after unsubscribe — no further increments
  assert.ok(n >= 2);
});
