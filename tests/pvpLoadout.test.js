// Per-player PvP loadout — equipped ranged weapon + per-caliber ammo.

import { test } from "node:test";
import assert from "node:assert/strict";

const {
  PVP_DEFAULT_RANGED, KUNAI_BULLET_ID, resetPvpLoadout, getPvpRangedWeapon, setPvpRangedWeapon,
  getPvpAmmo, hasPvpAmmo, addPvpAmmo, spendPvpAmmo, onPvpLoadoutChange, bulletOfWeapon,
} = await import("../js/pvpLoadout.js?v=20260530f");

const KUNAI = 7000, AR15 = 1169; // bullet species

test("bulletOfWeapon falls back to the kunai caliber for an unknown weapon", () => {
  // Species data isn't loaded in unit tests, so getSpecies() returns nothing →
  // the helper returns the shared kunai default rather than undefined.
  assert.equal(KUNAI_BULLET_ID, 7000);
  assert.equal(bulletOfWeapon(999999), KUNAI_BULLET_ID);
  assert.equal(bulletOfWeapon(undefined), KUNAI_BULLET_ID);
});

test("reset: kunai launcher equipped, no ammo", () => {
  resetPvpLoadout();
  assert.equal(getPvpRangedWeapon(0), PVP_DEFAULT_RANGED);
  assert.equal(getPvpRangedWeapon(1), PVP_DEFAULT_RANGED);
  assert.equal(getPvpAmmo(0, KUNAI), 0);
  assert.equal(hasPvpAmmo(0, KUNAI), false);
});

test("ammo is tracked per caliber, per player", () => {
  resetPvpLoadout();
  addPvpAmmo(0, KUNAI, 10);
  addPvpAmmo(0, AR15, 100);
  assert.equal(getPvpAmmo(0, KUNAI), 10);
  assert.equal(getPvpAmmo(0, AR15), 100, "different caliber, separate count");
  assert.equal(getPvpAmmo(1, KUNAI), 0, "different player, separate pool");
});

test("spend decrements only the matching caliber", () => {
  resetPvpLoadout();
  addPvpAmmo(0, KUNAI, 2);
  addPvpAmmo(0, AR15, 5);
  assert.equal(spendPvpAmmo(0, KUNAI), true);
  assert.equal(getPvpAmmo(0, KUNAI), 1);
  assert.equal(getPvpAmmo(0, AR15), 5, ".223 untouched by firing kunai");
});

test("spend fails when that caliber is empty", () => {
  resetPvpLoadout();
  addPvpAmmo(0, KUNAI, 1);
  assert.equal(spendPvpAmmo(0, KUNAI), true);
  assert.equal(spendPvpAmmo(0, KUNAI), false);
  assert.equal(spendPvpAmmo(0, AR15), false, "never had .223");
});

test("equipped weapon is per player and reset-able", () => {
  resetPvpLoadout();
  setPvpRangedWeapon(0, 1154); // AR15 weapon
  assert.equal(getPvpRangedWeapon(0), 1154);
  assert.equal(getPvpRangedWeapon(1), PVP_DEFAULT_RANGED, "P2 unchanged");
  resetPvpLoadout();
  assert.equal(getPvpRangedWeapon(0), PVP_DEFAULT_RANGED, "reset re-equips default");
});

test("guards: bad index / non-positive amount / falsy ids", () => {
  resetPvpLoadout();
  addPvpAmmo(9, KUNAI, 5);
  addPvpAmmo(0, KUNAI, 0);
  addPvpAmmo(0, 0, 5);
  setPvpRangedWeapon(0, 0);
  assert.equal(getPvpAmmo(0, KUNAI), 0);
  assert.equal(getPvpRangedWeapon(0), PVP_DEFAULT_RANGED);
});

test("listeners fire on reset, equip, add and spend", () => {
  let n = 0;
  const off = onPvpLoadoutChange(() => n++);
  resetPvpLoadout();
  setPvpRangedWeapon(0, 1154);
  addPvpAmmo(0, KUNAI, 3);
  spendPvpAmmo(0, KUNAI);
  off();
  addPvpAmmo(0, KUNAI, 1);
  assert.ok(n >= 4);
});
