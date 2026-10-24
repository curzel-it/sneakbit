// Co-op starter kit: every co-op player ends up owning a sword (equipped when
// the melee slot is empty) and at least KUNAI_STARTER_COUNT kunai.

import { test } from "node:test";
import assert from "node:assert/strict";

const { loadSpeciesData } = await import("../js/species.js");

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
  giveCoopStarterKit, SWORD_ITEM_ID, SWORD_WEAPON_ID, KUNAI_SPECIES_ID, KUNAI_STARTER_COUNT,
} = await import("../js/starterGift.js");

const OTHER_MELEE_ID = 1170;

function fresh() {
  storage._resetStorageForTesting();
  inventory.clearInventory();
}

test("empty-handed player gets the sword (item + equipped) and the kunai", () => {
  fresh();
  assert.equal(giveCoopStarterKit(0), true);
  assert.equal(inventory.getAmmo(SWORD_ITEM_ID, 0), 1);
  assert.equal(equipment.getEquipped(equipment.SLOT_MELEE, 0), SWORD_WEAPON_ID);
  assert.equal(inventory.getAmmo(KUNAI_SPECIES_ID, 0), KUNAI_STARTER_COUNT);
});

test("plenty of kunai still gets the sword, and keeps every kunai", () => {
  fresh();
  inventory.addAmmo(KUNAI_SPECIES_ID, 50, 0);
  assert.equal(giveCoopStarterKit(0), true);
  assert.equal(inventory.getAmmo(SWORD_ITEM_ID, 0), 1);
  assert.equal(inventory.getAmmo(KUNAI_SPECIES_ID, 0), 50);
});

test("a few kunai are topped up to the starter count", () => {
  fresh();
  inventory.addAmmo(KUNAI_SPECIES_ID, 3, 0);
  giveCoopStarterKit(0);
  assert.equal(inventory.getAmmo(KUNAI_SPECIES_ID, 0), KUNAI_STARTER_COUNT);
});

test("another melee weapon equipped → sword added but not swapped in", () => {
  fresh();
  equipment.setEquipped(equipment.SLOT_MELEE, OTHER_MELEE_ID, 0);
  assert.equal(giveCoopStarterKit(0), true);
  assert.equal(inventory.getAmmo(SWORD_ITEM_ID, 0), 1);
  assert.equal(equipment.getEquipped(equipment.SLOT_MELEE, 0), OTHER_MELEE_ID);
});

test("owned but unequipped sword → equipped, no duplicate item", () => {
  fresh();
  inventory.addAmmo(SWORD_ITEM_ID, 1, 0);
  assert.equal(giveCoopStarterKit(0), false);
  assert.equal(inventory.getAmmo(SWORD_ITEM_ID, 0), 1);
  assert.equal(equipment.getEquipped(equipment.SLOT_MELEE, 0), SWORD_WEAPON_ID);
});

test("idempotent: a second call changes nothing", () => {
  fresh();
  assert.equal(giveCoopStarterKit(0), true);
  assert.equal(giveCoopStarterKit(0), false);
  assert.equal(inventory.getAmmo(SWORD_ITEM_ID, 0), 1);
  assert.equal(inventory.getAmmo(KUNAI_SPECIES_ID, 0), KUNAI_STARTER_COUNT);
});

test("per-player: kitting index 2 leaves index 0 untouched", () => {
  fresh();
  giveCoopStarterKit(2);
  assert.equal(inventory.getAmmo(SWORD_ITEM_ID, 2), 1);
  assert.equal(equipment.getEquipped(equipment.SLOT_MELEE, 2), SWORD_WEAPON_ID);
  assert.equal(inventory.getAmmo(KUNAI_SPECIES_ID, 2), KUNAI_STARTER_COUNT);
  assert.equal(inventory.getAmmo(SWORD_ITEM_ID, 0), 0);
  assert.equal(equipment.getEquipped(equipment.SLOT_MELEE, 0), null);
});
