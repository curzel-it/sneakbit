import { test } from "node:test";
import assert from "node:assert/strict";

const { loadSpeciesData } = await import("../js/species.js?v=20260528c");

// Minimal species set: the kunai launcher default + the AR15 (1154 →
// bullet 1169) and the cannon (1167 → bullet 1170). All four real
// fields are present so resolveRangedWeapon can navigate them.
loadSpeciesData([
  { id: 1160, entity_type: "WeaponRanged", sprite_sheet_id: 1000,
    bullet_species_id: 7000, cooldown_after_use: 0.35,
    bullet_lifespan: 1.6,
    sprite_frame: { x: 0, y: 0, w: 1, h: 1 } },
  { id: 1154, entity_type: "WeaponRanged", sprite_sheet_id: 1022,
    bullet_species_id: 1169, cooldown_after_use: 0.18,
    bullet_lifespan: 2.0,
    sprite_frame: { x: 17, y: 1, w: 4, h: 4 } },
  { id: 1167, entity_type: "WeaponRanged", sprite_sheet_id: 1022,
    bullet_species_id: 1170, cooldown_after_use: 0.7,
    bullet_lifespan: 2.0,
    sprite_frame: { x: 33, y: 1, w: 4, h: 4 } },
  { id: 1169, entity_type: "Bullet", sprite_sheet_id: 1022,
    base_speed: 10, dps: 600,
    sprite_frame: { x: 17, y: 61, w: 1, h: 1 } },
  { id: 1170, entity_type: "Bullet", sprite_sheet_id: 1022,
    base_speed: 6, dps: 1200,
    sprite_frame: { x: 33, y: 61, w: 1, h: 1 } },
]);

const { setEquipped, clearEquipped, getEquipped, SLOT_RANGED,
        DEFAULT_RANGED_WEAPON_ID } =
  await import("../js/equipment.js?v=20260528c");

test("default ranged weapon is the kunai launcher", () => {
  clearEquipped(SLOT_RANGED);
  assert.equal(getEquipped(SLOT_RANGED), DEFAULT_RANGED_WEAPON_ID);
  assert.equal(DEFAULT_RANGED_WEAPON_ID, 1160);
});

test("equipping the AR15 makes it the active ranged weapon", () => {
  setEquipped(SLOT_RANGED, 1154);
  assert.equal(getEquipped(SLOT_RANGED), 1154);
});

test("equipping the cannon swaps to its bullet species", () => {
  setEquipped(SLOT_RANGED, 1167);
  assert.equal(getEquipped(SLOT_RANGED), 1167);
});

test("clearing the slot restores the kunai launcher", () => {
  setEquipped(SLOT_RANGED, 1167);
  clearEquipped(SLOT_RANGED);
  assert.equal(getEquipped(SLOT_RANGED), 1160);
});
