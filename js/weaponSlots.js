// The set of weapons a player can equip in a given slot, in a stable
// order, with the active one flagged. Single source of truth shared by
// the quick-switch cycle (weaponSelect.js) and the inventory screen
// (inventoryScreen.js) so the two can never disagree on membership or
// order. Pure, DOM-free, and dependency-light so it's unit-testable.
//
// A weapon is "owned" when an inventory item carries an `associated_weapon`
// pointing at a WeaponMelee/WeaponRanged species (mirrors how pickups.js
// auto-equips). Ranged always leads with the default kunai launcher
// (it's the implicit fallback weapon); melee has no baseline.

import { getSpecies } from "./species.js";
import { snapshotInventory, getAmmo } from "./inventory.js";
import { getEquipped, SLOT_RANGED, SLOT_MELEE, DEFAULT_RANGED_WEAPON_ID } from "./equipment.js";

const KUNAI_BULLET_SPECIES_ID = 7000; // default ranged ammo when species data is absent (tests)

// Ranged weapons consume the bullet their species names; melee weapons
// have no ammo. Returns the live count, or null for melee.
function ammoFor(weaponSp, slot, playerIndex) {
  if (slot !== SLOT_RANGED) return null;
  const bulletId = weaponSp?.bullet_species_id || KUNAI_BULLET_SPECIES_ID;
  return getAmmo(bulletId, playerIndex);
}

// The weapons the player owns for `slot`, derived from inventory items
// whose associated_weapon is a weapon of the matching kind. Returns
// [{ id, count }] ascending by weapon id for a deterministic cycle order;
// `count` sums the granting items the player holds.
function ownedWeapons(slot, playerIndex) {
  const wanted = slot === SLOT_MELEE ? "WeaponMelee" : "WeaponRanged";
  const counts = snapshotInventory(playerIndex);
  const byWeapon = new Map(); // weaponId -> total granting-item count
  for (const key of Object.keys(counts)) {
    const n = counts[key] | 0;
    if (n <= 0) continue;
    const itemSp = getSpecies(Number(key));
    const weaponId = itemSp?.associated_weapon;
    if (!weaponId) continue;
    const weaponSp = getSpecies(weaponId);
    if (weaponSp?.entity_type !== wanted) continue;
    byWeapon.set(weaponId, (byWeapon.get(weaponId) || 0) + n);
  }
  return [...byWeapon.entries()]
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => a.id - b.id);
}

// Ordered list of equippable weapons for the slot. Each entry:
//   { id, species, count, ammo, isEquipped, isDefault }
// Ranged leads with the default kunai launcher; melee is purely owned
// weapons (the inventory screen prepends its own "Unarmed" choice — this
// list never includes it, since you can't cycle *to* nothing).
export function weaponsInSlot(slot, playerIndex = 0) {
  const equippedId = getEquipped(slot, playerIndex);
  const out = [];

  if (slot === SLOT_RANGED) {
    const sp = getSpecies(DEFAULT_RANGED_WEAPON_ID);
    out.push({
      id: DEFAULT_RANGED_WEAPON_ID,
      species: sp,
      count: null, // implicit weapon, not an inventory item
      ammo: ammoFor(sp, slot, playerIndex),
      isEquipped: equippedId === DEFAULT_RANGED_WEAPON_ID,
      isDefault: true,
    });
  }

  for (const { id: weaponId, count } of ownedWeapons(slot, playerIndex)) {
    if (slot === SLOT_RANGED && weaponId === DEFAULT_RANGED_WEAPON_ID) continue; // dedup the default
    const sp = getSpecies(weaponId);
    out.push({
      id: weaponId,
      species: sp,
      count,
      ammo: ammoFor(sp, slot, playerIndex),
      isEquipped: equippedId === weaponId,
      isDefault: false,
    });
  }

  return out;
}

// The id one step (`dir` = +1 next / -1 prev) from the currently-equipped
// weapon, wrapping at both ends. Returns null when there are fewer than 2
// weapons to choose from — this is the gate the cycle relies on. A stale
// or absent equipped id is treated as position 0.
export function nextWeaponInSlot(slot, playerIndex = 0, dir = +1) {
  const list = weaponsInSlot(slot, playerIndex);
  if (list.length < 2) return null;
  let cur = list.findIndex((e) => e.isEquipped);
  if (cur < 0) cur = 0;
  const step = dir < 0 ? -1 : 1;
  const n = list.length;
  const next = ((cur + step) % n + n) % n;
  return list[next].id;
}
