// Co-op starter kit. Everyone in a co-op session — the host, each online
// guest, and every local P2..P4 — gets a sword and a stack of kunai, so the
// whole party can fight at both short and long range. The sword item lands in
// the inventory (so it shows in the inventory + weapon-cycle) and is equipped
// when the melee slot is empty; kunai are topped up, never reduced.

import { getAmmo, addAmmo } from "./inventory.js";
import { getEquipped, setEquipped, SLOT_MELEE } from "./equipment.js";

export const KUNAI_SPECIES_ID = 7000;
export const KUNAI_STARTER_COUNT = 10;
// Sword pickup item -> its associated WeaponMelee (data/species.json). Granting
// the item (not just equipping the weapon) keeps the sword in the inventory and
// the melee cycle, exactly like grabbing one off the floor.
export const SWORD_ITEM_ID = 1164;
export const SWORD_WEAPON_ID = 1159;

// Hand the player the co-op starter kit. Idempotent: a player who already owns
// the sword and enough kunai is left alone, and a melee weapon they picked is
// never swapped out. Returns true when the sword was newly granted.
export function giveCoopStarterKit(playerIndex = 0) {
  const idx = playerIndex | 0;
  const kunai = getAmmo(KUNAI_SPECIES_ID, idx);
  if (kunai < KUNAI_STARTER_COUNT) addAmmo(KUNAI_SPECIES_ID, KUNAI_STARTER_COUNT - kunai, idx);
  const grantSword = getAmmo(SWORD_ITEM_ID, idx) <= 0;
  if (grantSword) addAmmo(SWORD_ITEM_ID, 1, idx);
  if (getEquipped(SLOT_MELEE, idx) == null) setEquipped(SLOT_MELEE, SWORD_WEAPON_ID, idx);
  return grantSword;
}
