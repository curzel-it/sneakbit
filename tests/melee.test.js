// Melee combat: the swing spawns short-lived bullets in an arc in front of
// the hero. Each bullet carries a dps override = bullet.dps *
// weapon.melee_dps_multiplier so combat.js applies the correct damage.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadSpeciesData } from "../js/species.js";

function loadSword(meleeDpsMultiplier = 1, bulletDps = 450) {
  loadSpeciesData([
    { id: 1159, entity_type: "WeaponMelee", sprite_sheet_id: 1022,
      bullet_species_id: 1166, cooldown_after_use: 0.35, bullet_lifespan: 0.4,
      equipment_usage_sound_effect: "SwordSlash",
      melee_dps_multiplier: meleeDpsMultiplier,
      sprite_frame: { x: 1, y: 1, w: 4, h: 4 } },
    { id: 1166, entity_type: "Bullet", sprite_sheet_id: 1022,
      dps: bulletDps, base_speed: 0,
      sprite_frame: { x: 0, y: 0, w: 1, h: 1 } },
  ]);
}

loadSword();

const melee = await import("../js/melee.js");
const equipment = await import("../js/equipment.js");
const storage = await import("../js/storage.js");

function fakeState() {
  return {
    zone: { entities: [] },
    player: { tileX: 10, tileY: 10, direction: "right" },
  };
}

test("performMeleeSwing: no-op when no melee weapon equipped", () => {
  storage._resetStorageForTesting();
  const s = fakeState();
  const ok = melee.performMeleeSwing(s, { ignoreCooldown: true });
  assert.equal(ok, false);
  assert.equal(s.zone.entities.length, 0);
});

const r2 = (n) => Math.round(n * 100) / 100 + 0;

function offsetsOf(s) {
  return s.zone.entities
    .map(b => `${r2(b.frame.x - s.player.tileX)},${r2(b.frame.y - s.player.tileY)}`)
    .sort();
}

test("performMeleeSwing: spawns 6 bullets in an arc in front of the hero", () => {
  storage._resetStorageForTesting();
  equipment.setEquipped(equipment.SLOT_MELEE, 1159);
  const s = fakeState();
  const ok = melee.performMeleeSwing(s, { ignoreCooldown: true });
  assert.equal(ok, true);
  assert.equal(s.zone.entities.length, 6);
  const expected = ["0,0", "1,0", "0.8,0.8", "0.8,-0.8", "0.2,0.9", "0.2,-0.9"].sort();
  assert.deepEqual(offsetsOf(s), expected);

  for (const b of s.zone.entities) {
    assert.equal(b._spawned, true);
    assert.equal(b.species_id, 1166);
    assert.equal(b._dpsOverride, 450);
    assert.ok(b._lifespan > 0);
  }
});

test("performMeleeSwing: applies melee_dps_multiplier", () => {
  storage._resetStorageForTesting();
  loadSword(2, 100); // expected dps = 100 * 2 = 200
  equipment.setEquipped(equipment.SLOT_MELEE, 1159);
  const s = fakeState();
  assert.equal(melee.performMeleeSwing(s, { ignoreCooldown: true }), true);
  for (const b of s.zone.entities) {
    assert.equal(b._dpsOverride, 200);
  }
});

test("performMeleeSwing: refuses non-melee species in melee slot", () => {
  storage._resetStorageForTesting();
  loadSpeciesData([
    { id: 9999, entity_type: "WeaponRanged", sprite_sheet_id: 1000,
      bullet_species_id: 7000,
      sprite_frame: { x: 0, y: 0, w: 1, h: 1 } },
  ]);
  equipment.setEquipped(equipment.SLOT_MELEE, 9999);
  const s = fakeState();
  assert.equal(melee.performMeleeSwing(s, { ignoreCooldown: true }), false);
  assert.equal(s.zone.entities.length, 0);
});

test("performMeleeSwing: nothing reaches behind the hero", () => {
  storage._resetStorageForTesting();
  loadSword();
  equipment.setEquipped(equipment.SLOT_MELEE, 1159);
  const s = fakeState();
  s.player.direction = "right";
  assert.equal(melee.performMeleeSwing(s, { ignoreCooldown: true }), true);
  for (const e of s.zone.entities) assert.ok(e.frame.x >= 10, `bullet behind the hero at x=${e.frame.x}`);
});

test("performMeleeSwing: the arc follows the facing direction", () => {
  storage._resetStorageForTesting();
  loadSword();
  equipment.setEquipped(equipment.SLOT_MELEE, 1159);
  const s = fakeState();
  s.player.direction = "up";
  assert.equal(melee.performMeleeSwing(s, { ignoreCooldown: true }), true);
  const expected = ["0,0", "0,-1", "0.8,-0.8", "-0.8,-0.8", "0.9,-0.2", "-0.9,-0.2"].sort();
  assert.deepEqual(offsetsOf(s), expected);
});

test("performMeleeSwing: the arc is anchored on the free position", () => {
  storage._resetStorageForTesting();
  loadSword();
  equipment.setEquipped(equipment.SLOT_MELEE, 1159);
  const s = fakeState();
  s.player.x = 10.4;
  s.player.y = 9.7;
  assert.equal(melee.performMeleeSwing(s, { ignoreCooldown: true }), true);
  assert.ok(s.zone.entities.some((e) => r2(e.frame.x) === 11.4 && r2(e.frame.y) === 9.7), "forward bullet");
});
