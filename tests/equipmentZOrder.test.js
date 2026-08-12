// Which side of the hero an equipped weapon draws on. Mirrors Rust
// equipment/basics.rs::should_be_over_hero (facing Up puts the weapon in
// front), plus the in-use lift that flips the weapon playing its
// attack-row strip over the body.
//
// Regression: the lift used to be one flag for the whole loadout, so
// throwing a kunai — a *ranged* animation — dragged the sheathed sword in
// front of the hero's chest as well. Each slot decides for itself now.

import { test } from "node:test";
import assert from "node:assert/strict";
import { isEquipmentInFront } from "../js/entities.js";
import { SLOT_MELEE, SLOT_RANGED, SLOT_HELMET } from "../js/equipment.js";
import { setSwingAnimation, tickMelee } from "../js/melee.js";
import { predictGuestShoot, getShootAnimProgress, tickShooting } from "../js/shooting.js";

const hero = (direction = "down", index = 0) => ({ direction, index, tileX: 3, tileY: 3 });

// Drain both per-player animation timers back to idle.
function idle() {
  tickMelee(10_000);
  tickShooting(10_000);
}

test("idle and facing anywhere but up, both weapons draw behind the hero", () => {
  idle();
  for (const dir of ["down", "left", "right"]) {
    assert.equal(isEquipmentInFront(hero(dir), SLOT_MELEE), false, dir);
    assert.equal(isEquipmentInFront(hero(dir), SLOT_RANGED), false, dir);
  }
});

test("facing up puts both weapons in front (handle/barrel past the shoulder)", () => {
  idle();
  assert.equal(isEquipmentInFront(hero("up"), SLOT_MELEE), true);
  assert.equal(isEquipmentInFront(hero("up"), SLOT_RANGED), true);
});

test("a melee swing lifts the sword only — the ranged weapon stays behind", () => {
  idle();
  setSwingAnimation(0, 0.35, 0.35);
  assert.equal(isEquipmentInFront(hero("down"), SLOT_MELEE), true);
  assert.equal(isEquipmentInFront(hero("down"), SLOT_RANGED), false);
  idle();
});

test("throwing a kunai lifts the ranged weapon only — the sword stays behind", () => {
  idle();
  predictGuestShoot(hero("down"));
  assert.notEqual(getShootAnimProgress(0), null, "firing pose should be armed");
  assert.equal(isEquipmentInFront(hero("down"), SLOT_RANGED), true);
  assert.equal(isEquipmentInFront(hero("down"), SLOT_MELEE), false,
    "the sheathed sword must not follow the kunai in front of the hero");
  idle();
});

test("the lift is per player index — a teammate's swing doesn't move my sword", () => {
  idle();
  setSwingAnimation(1, 0.35, 0.35);
  assert.equal(isEquipmentInFront(hero("down", 1), SLOT_MELEE), true);
  assert.equal(isEquipmentInFront(hero("down", 0), SLOT_MELEE), false);
  idle();
});

test("armour slots never consult the weapon animations (they always overlay)", () => {
  idle();
  setSwingAnimation(0, 0.35, 0.35);
  assert.equal(isEquipmentInFront(hero("down"), SLOT_HELMET), false);
  idle();
});
