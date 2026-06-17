// Starter-weapon gift rule: a co-op player joining with under 5 kunai and no
// melee weapon is handed a sword (item lands in inventory + weapon equipped).

import { test } from "node:test";
import assert from "node:assert/strict";

const { loadSpeciesData } = await import("../js/species.js");

// Sword weapon (1159, WeaponMelee), its granting pickup item (1164), and the
// kunai bullet (7000) — the minimum species the gift logic touches.
loadSpeciesData([
  { id: 1159, entity_type: "WeaponMelee", sprite_sheet_id: 1022,
    sprite_frame: { x: 49, y: 1, w: 4, h: 4 } },
  { id: 1164, entity_type: "PickableObject", associated_weapon: 1159,
    sprite_frame: { x: 1, y: 53, w: 1, h: 2 } },
  { id: 7000, entity_type: "Bullet", sprite_sheet_id: 1014,
    base_speed: 9, dps: 100, sprite_frame: { x: 4, y: 0, w: 1, h: 1 } },
]);

const inventory = await import("../js/inventory.js");
const equipment = await import("../js/equipment.js");
const storage = await import("../js/storage.js");
const {
  giftStarterWeaponIfNeeded, SWORD_ITEM_ID, SWORD_WEAPON_ID, KUNAI_SPECIES_ID,
} = await import("../js/starterGift.js");

function fresh() {
  storage._resetStorageForTesting();
  inventory.clearInventory();
}

test("under 5 kunai and no melee → gifts the sword (item + equipped weapon)", () => {
  fresh();
  const gifted = giftStarterWeaponIfNeeded(0);
  assert.equal(gifted, true);
  assert.equal(inventory.getAmmo(SWORD_ITEM_ID, 0), 1, "sword item in inventory");
  assert.equal(equipment.getEquipped(equipment.SLOT_MELEE, 0), SWORD_WEAPON_ID, "sword equipped");
});

test("5+ kunai → no gift (player is armed enough)", () => {
  fresh();
  inventory.addAmmo(KUNAI_SPECIES_ID, 5, 0);
  assert.equal(giftStarterWeaponIfNeeded(0), false);
  assert.equal(inventory.getAmmo(SWORD_ITEM_ID, 0), 0);
  assert.equal(equipment.getEquipped(equipment.SLOT_MELEE, 0), null);
});

test("already holds a melee weapon → no gift", () => {
  fresh();
  // Owns a sword item but hasn't equipped it — still counts as having a melee.
  inventory.addAmmo(SWORD_ITEM_ID, 1, 0);
  assert.equal(giftStarterWeaponIfNeeded(0), false);
  assert.equal(inventory.getAmmo(SWORD_ITEM_ID, 0), 1, "no duplicate sword item added");
});

test("melee equipped (no item) → no gift", () => {
  fresh();
  equipment.setEquipped(equipment.SLOT_MELEE, SWORD_WEAPON_ID, 0);
  assert.equal(giftStarterWeaponIfNeeded(0), false);
});

test("idempotent: a second call after gifting does nothing", () => {
  fresh();
  assert.equal(giftStarterWeaponIfNeeded(0), true);
  assert.equal(giftStarterWeaponIfNeeded(0), false, "second call is a no-op");
  assert.equal(inventory.getAmmo(SWORD_ITEM_ID, 0), 1, "still just one sword");
});

test("per-player: gifting a guest at index 1 leaves index 0 untouched", () => {
  fresh();
  giftStarterWeaponIfNeeded(1);
  assert.equal(inventory.getAmmo(SWORD_ITEM_ID, 1), 1);
  assert.equal(equipment.getEquipped(equipment.SLOT_MELEE, 1), SWORD_WEAPON_ID);
  assert.equal(inventory.getAmmo(SWORD_ITEM_ID, 0), 0, "P1 inventory untouched");
  assert.equal(equipment.getEquipped(equipment.SLOT_MELEE, 0), null, "P1 melee untouched");
});
