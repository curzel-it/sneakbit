// Melee combat: the swing spawns 5 short-lived bullets in a cross pattern
// around the hero. Each bullet carries a dps override = bullet.dps *
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

test("performMeleeSwing: spawns 5 bullets in cross pattern", () => {
  storage._resetStorageForTesting();
  equipment.setEquipped(equipment.SLOT_MELEE, 1159);
  const s = fakeState();
  const ok = melee.performMeleeSwing(s, { ignoreCooldown: true });
  assert.equal(ok, true);
  assert.equal(s.zone.entities.length, 5);

  const offsets = s.zone.entities
    .map(b => [b.frame.x - s.player.tileX, b.frame.y - s.player.tileY])
    .map(([x, y]) => `${x},${y}`)
    .sort();
  const expected = ["0,0", "0,-1", "0,1", "1,0", "-1,0"].sort();
  assert.deepEqual(offsets, expected);

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
