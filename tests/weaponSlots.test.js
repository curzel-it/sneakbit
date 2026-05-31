import { test } from "node:test";
import assert from "node:assert/strict";

const { loadSpeciesData } = await import("../js/species.js");

// Weapons + the inventory items that grant them. A pickup item carries
// `associated_weapon` pointing at the weapon species (mirrors real data):
//   item 5154 → AR15 (1154), item 5167 → cannon (1167),
//   item 5159 → sword (1159), item 5190 → a 2nd melee (1190).
loadSpeciesData([
  { id: 1160, entity_type: "WeaponRanged", bullet_species_id: 7000 }, // kunai launcher (default)
  { id: 1154, entity_type: "WeaponRanged", bullet_species_id: 1169 }, // AR15
  { id: 1167, entity_type: "WeaponRanged", bullet_species_id: 1170 }, // cannon
  { id: 1159, entity_type: "WeaponMelee",  bullet_species_id: 1166 }, // sword
  { id: 1190, entity_type: "WeaponMelee",  bullet_species_id: 1166 }, // 2nd melee (hypothetical)
  { id: 5154, entity_type: "PickableObject", associated_weapon: 1154 },
  { id: 5167, entity_type: "PickableObject", associated_weapon: 1167 },
  { id: 5159, entity_type: "PickableObject", associated_weapon: 1159 },
  { id: 5190, entity_type: "PickableObject", associated_weapon: 1190 },
  { id: 7000, entity_type: "Bullet" },
  { id: 1169, entity_type: "Bullet" },
  { id: 1170, entity_type: "Bullet" },
]);

const { weaponsInSlot, nextWeaponInSlot } = await import("../js/weaponSlots.js");
const { setEquipped, clearEquipped, SLOT_RANGED, SLOT_MELEE, DEFAULT_RANGED_WEAPON_ID } =
  await import("../js/equipment.js");
const inventory = await import("../js/inventory.js");
const storage = await import("../js/storage.js");

function reset() {
  storage._resetStorageForTesting();
  inventory.clearInventory();
}

test("ranged: only the default kunai launcher when nothing owned", () => {
  reset();
  const list = weaponsInSlot(SLOT_RANGED);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, DEFAULT_RANGED_WEAPON_ID);
  assert.equal(list[0].isDefault, true);
  assert.equal(list[0].isEquipped, true); // default is equipped when slot empty
  // < 2 entries → cycle is gated off.
  assert.equal(nextWeaponInSlot(SLOT_RANGED), null);
});

test("ranged: owned weapons append after the default, ascending by id", () => {
  reset();
  inventory.addAmmo(5167, 1); // cannon item
  inventory.addAmmo(5154, 1); // AR15 item
  const list = weaponsInSlot(SLOT_RANGED);
  assert.deepEqual(list.map((e) => e.id), [1160, 1154, 1167]);
  assert.equal(list[0].isDefault, true);
  assert.equal(list[1].isDefault, false);
});

test("ranged: ammo reflects the equipped weapon's bullet count", () => {
  reset();
  inventory.addAmmo(5154, 1);   // own the AR15
  inventory.addAmmo(1169, 24);  // 24 AR15 bullets
  inventory.addAmmo(7000, 5);   // 5 kunai
  const list = weaponsInSlot(SLOT_RANGED);
  const kunai = list.find((e) => e.id === 1160);
  const ar15 = list.find((e) => e.id === 1154);
  assert.equal(kunai.ammo, 5);
  assert.equal(ar15.ammo, 24);
  assert.equal(ar15.count, 1); // pickup item count
});

test("ranged: isEquipped tracks the equipped slot", () => {
  reset();
  inventory.addAmmo(5154, 1);
  setEquipped(SLOT_RANGED, 1154);
  const list = weaponsInSlot(SLOT_RANGED);
  assert.equal(list.find((e) => e.id === 1154).isEquipped, true);
  assert.equal(list.find((e) => e.id === 1160).isEquipped, false);
});

test("melee: no default, no implicit entry; empty when none owned", () => {
  reset();
  assert.deepEqual(weaponsInSlot(SLOT_MELEE), []);
  assert.equal(nextWeaponInSlot(SLOT_MELEE), null);
});

test("melee: a single sword does not enable the cycle", () => {
  reset();
  inventory.addAmmo(5159, 1);
  const list = weaponsInSlot(SLOT_MELEE);
  assert.deepEqual(list.map((e) => e.id), [1159]);
  assert.equal(list[0].ammo, null); // melee has no ammo
  assert.equal(nextWeaponInSlot(SLOT_MELEE), null);
});

test("melee: two weapons enable the cycle and wrap", () => {
  reset();
  inventory.addAmmo(5159, 1);
  inventory.addAmmo(5190, 1);
  setEquipped(SLOT_MELEE, 1159);
  assert.equal(nextWeaponInSlot(SLOT_MELEE, 0, +1), 1190);
  assert.equal(nextWeaponInSlot(SLOT_MELEE, 0, -1), 1190); // 2 items: both dirs land on the other
});

test("nextWeaponInSlot wraps in both directions", () => {
  reset();
  inventory.addAmmo(5154, 1); // AR15
  inventory.addAmmo(5167, 1); // cannon → list [1160, 1154, 1167]
  setEquipped(SLOT_RANGED, 1167);
  assert.equal(nextWeaponInSlot(SLOT_RANGED, 0, +1), 1160); // last → first
  setEquipped(SLOT_RANGED, 1160);
  assert.equal(nextWeaponInSlot(SLOT_RANGED, 0, -1), 1167); // first → last
  assert.equal(nextWeaponInSlot(SLOT_RANGED, 0, +1), 1154);
});

test("nextWeaponInSlot treats a stale equipped id as position 0", () => {
  reset();
  inventory.addAmmo(5154, 1); // list [1160, 1154]
  setEquipped(SLOT_RANGED, 9999); // not in the list
  assert.equal(nextWeaponInSlot(SLOT_RANGED, 0, +1), 1154); // from index 0 → next
  clearEquipped(SLOT_RANGED);
});
