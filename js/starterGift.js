// Starter-weapon gift for co-op players. A player entering a co-op session —
// a local P2..P4 spawning, or an online guest connecting — who arrives with
// almost no kunai and no melee weapon would otherwise be defenceless. So we
// hand them a sword, mirroring a floor pickup: the sword item lands in their
// inventory (so it shows in the inventory + weapon-cycle) and the sword weapon
// is equipped in their melee slot.

import { getAmmo, addAmmo } from "./inventory.js";
import { getEquipped, setEquipped, SLOT_MELEE } from "./equipment.js";
import { weaponsInSlot } from "./weaponSlots.js";

// Kunai bullet (the default ranged ammo). At or above this count the player is
// considered armed enough to skip the gift.
export const KUNAI_SPECIES_ID = 7000;
export const KUNAI_THRESHOLD = 5;
// Sword pickup item -> its associated WeaponMelee (data/species.json). Granting
// the item (not just equipping the weapon) keeps the sword in the inventory and
// the melee cycle, exactly like grabbing one off the floor.
export const SWORD_ITEM_ID = 1164;
export const SWORD_WEAPON_ID = 1159;

// True when the player has no melee weapon at all — neither one equipped nor
// one owned in the inventory (weaponsInSlot derives owned melee weapons from
// inventory items carrying an associated WeaponMelee). "No melee in the
// inventory" in requirement terms, read defensively so an already-armed
// player is never handed a redundant sword.
function hasNoMelee(playerIndex) {
  if (getEquipped(SLOT_MELEE, playerIndex) != null) return false;
  return weaponsInSlot(SLOT_MELEE, playerIndex).length === 0;
}

// Gift a sword to a co-op player who joined with <5 kunai and no melee weapon.
// Returns true if a sword was granted. Idempotent: once the player holds the
// sword (or any melee) the no-melee check fails, so a re-spawn / reconnect
// won't pile on extra swords.
export function giftStarterWeaponIfNeeded(playerIndex = 0) {
  const idx = playerIndex | 0;
  if (getAmmo(KUNAI_SPECIES_ID, idx) >= KUNAI_THRESHOLD) return false;
  if (!hasNoMelee(idx)) return false;
  addAmmo(SWORD_ITEM_ID, 1, idx);
  setEquipped(SLOT_MELEE, SWORD_WEAPON_ID, idx);
  return true;
}
