// The armour a player can equip in a given body slot, in a stable order,
// with the active one flagged. The armour counterpart to weaponSlots.js:
// the inventory screen reads armorInSlot to render its three armour panels.
// Pure, DOM-free, and dependency-light so it's unit-testable.
//
// A piece is "owned" when an inventory item carries an `associated_armour`
// pointing at an Armour species whose `armor_slot` matches (mirrors how
// pickups.js auto-equips). Each armour slot has no implicit baseline — an
// empty slot means no armour (the screen offers its own "None" choice).

import { getSpecies } from "./species.js";
import { snapshotInventory } from "./inventory.js";
import { getEquipped, ARMOR_SLOTS } from "./equipment.js";

// The armour the player owns for `slot`, derived from inventory items whose
// associated_armour is an Armour piece for that slot. Returns [{ id, count }]
// ascending by armour species id for a deterministic order; `count` sums the
// granting items the player holds.
function ownedArmor(slot, playerIndex) {
  const counts = snapshotInventory(playerIndex);
  const byArmor = new Map(); // armourId -> total granting-item count
  for (const key of Object.keys(counts)) {
    const n = counts[key] | 0;
    if (n <= 0) continue;
    const itemSp = getSpecies(Number(key));
    const armourId = itemSp?.associated_armour;
    if (!armourId) continue;
    const armourSp = getSpecies(armourId);
    if (armourSp?.entity_type !== "Armour") continue;
    if (armourSp.armor_slot !== slot) continue;
    byArmor.set(armourId, (byArmor.get(armourId) || 0) + n);
  }
  return [...byArmor.entries()]
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => a.id - b.id);
}

// Ordered list of equippable armour for the slot. Each entry:
//   { id, species, count, isEquipped }
// The inventory screen prepends its own "None" choice — this list never
// includes it, since you can't equip nothing as a piece.
export function armorInSlot(slot, playerIndex = 0) {
  if (!ARMOR_SLOTS.includes(slot)) return [];
  const equippedId = getEquipped(slot, playerIndex);
  return ownedArmor(slot, playerIndex).map(({ id, count }) => ({
    id,
    species: getSpecies(id),
    count,
    isEquipped: equippedId === id,
  }));
}
