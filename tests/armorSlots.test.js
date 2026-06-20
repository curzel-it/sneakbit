import { test } from "node:test";
import assert from "node:assert/strict";

const { loadSpeciesData } = await import("../js/species.js");

// Three armour pieces (one per body slot) + the inventory items that grant
// them. A pickup item carries `associated_armour` pointing at the Armour
// species (mirrors real data):
//   item 1194 → helmet (1190), item 1195 → chest (1191), item 1196 → legs (1192).
// Two helmets (1190 + a hypothetical 1198) so ordering is exercised.
loadSpeciesData([
  { id: 1190, entity_type: "Armour", armor_slot: "helmet", received_damage_reduction: 0.1 },
  { id: 1191, entity_type: "Armour", armor_slot: "chest",  received_damage_reduction: 0.2 },
  { id: 1192, entity_type: "Armour", armor_slot: "legs",   received_damage_reduction: 0.1 },
  { id: 1198, entity_type: "Armour", armor_slot: "helmet", received_damage_reduction: 0.3 },
  { id: 1194, entity_type: "PickableObject", associated_armour: 1190 },
  { id: 1195, entity_type: "PickableObject", associated_armour: 1191 },
  { id: 1196, entity_type: "PickableObject", associated_armour: 1192 },
  { id: 1199, entity_type: "PickableObject", associated_armour: 1198 },
  { id: 1159, entity_type: "WeaponMelee" }, // a weapon item must NOT leak into armour slots
  { id: 5159, entity_type: "PickableObject", associated_weapon: 1159 },
]);

const { armorInSlot } = await import("../js/armorSlots.js");
const {
  setEquipped, clearEquipped, getEquipped, snapshotEquipment,
  SLOT_HELMET, SLOT_CHEST, SLOT_LEGS, ARMOR_SLOTS,
} = await import("../js/equipment.js");
const inventory = await import("../js/inventory.js");
const storage = await import("../js/storage.js");

function reset() {
  storage._resetStorageForTesting();
  inventory.clearInventory();
}

test("an empty slot lists nothing", () => {
  reset();
  assert.deepEqual(armorInSlot(SLOT_HELMET), []);
});

test("owned armour appears in its slot, ascending by id", () => {
  reset();
  inventory.addAmmo(1199, 1); // helmet #2 item
  inventory.addAmmo(1194, 1); // helmet #1 item
  const list = armorInSlot(SLOT_HELMET);
  assert.deepEqual(list.map((e) => e.id), [1190, 1198]);
});

test("armour is partitioned by body slot", () => {
  reset();
  inventory.addAmmo(1194, 1); // helmet
  inventory.addAmmo(1195, 1); // chest
  assert.deepEqual(armorInSlot(SLOT_HELMET).map((e) => e.id), [1190]);
  assert.deepEqual(armorInSlot(SLOT_CHEST).map((e) => e.id), [1191]);
  assert.deepEqual(armorInSlot(SLOT_LEGS), []);
});

test("weapon items never leak into armour slots", () => {
  reset();
  inventory.addAmmo(5159, 1); // a sword (weapon) item
  for (const slot of ARMOR_SLOTS) assert.deepEqual(armorInSlot(slot), []);
});

test("the equipped piece is flagged", () => {
  reset();
  inventory.addAmmo(1194, 1);
  inventory.addAmmo(1199, 1);
  setEquipped(SLOT_HELMET, 1198, 0);
  const list = armorInSlot(SLOT_HELMET);
  assert.equal(list.find((e) => e.id === 1198).isEquipped, true);
  assert.equal(list.find((e) => e.id === 1190).isEquipped, false);
});

test("armour slots equip / clear independently and default to empty", () => {
  reset();
  for (const slot of ARMOR_SLOTS) assert.equal(getEquipped(slot, 0), null);
  setEquipped(SLOT_LEGS, 1192, 0);
  assert.equal(getEquipped(SLOT_LEGS, 0), 1192);
  assert.equal(getEquipped(SLOT_HELMET, 0), null);
  clearEquipped(SLOT_LEGS, 0);
  assert.equal(getEquipped(SLOT_LEGS, 0), null);
});

test("snapshotEquipment carries every armour slot", () => {
  reset();
  setEquipped(SLOT_HELMET, 1190, 0);
  setEquipped(SLOT_CHEST, 1191, 0);
  const snap = snapshotEquipment(0);
  assert.equal(snap.armor.helmet, 1190);
  assert.equal(snap.armor.chest, 1191);
  assert.equal(snap.armor.legs, null);
});
