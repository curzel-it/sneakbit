// Tracks the player's currently-equipped melee and ranged weapons.
// Mirrors Rust equipment/basics.rs: per-player slot, stored as the weapon
// species id. Default ranged = kunai launcher (1160); default melee = none.
// Exposes `window.equipment` for devtools (parity with window.skills).

import { getValue, setValue } from "./storage.js";

export const SLOT_RANGED = "ranged";
export const SLOT_MELEE  = "melee";

const KEY_RANGED = "player.0.equipped.ranged";
const KEY_MELEE  = "player.0.equipped.melee";

export const DEFAULT_RANGED_WEAPON_ID = 1160; // kunai launcher

const listeners = new Set();

export function getEquipped(slot) {
  if (slot === SLOT_RANGED) {
    const v = getValue(KEY_RANGED);
    return v == null ? DEFAULT_RANGED_WEAPON_ID : v;
  }
  if (slot === SLOT_MELEE) {
    const v = getValue(KEY_MELEE);
    return v == null ? null : v;
  }
  return null;
}

export function setEquipped(slot, speciesId) {
  if (slot !== SLOT_RANGED && slot !== SLOT_MELEE) return;
  const key = slot === SLOT_RANGED ? KEY_RANGED : KEY_MELEE;
  setValue(key, speciesId);
  for (const fn of listeners) fn(slot, speciesId);
}

export function clearEquipped(slot) {
  if (slot !== SLOT_RANGED && slot !== SLOT_MELEE) return;
  const key = slot === SLOT_RANGED ? KEY_RANGED : KEY_MELEE;
  setValue(key, null);
  for (const fn of listeners) fn(slot, null);
}

export function onEquipmentChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

if (typeof window !== "undefined") {
  window.equipment = {
    get:    getEquipped,
    set:    setEquipped,
    clear:  clearEquipped,
    SLOT_RANGED,
    SLOT_MELEE,
  };
}
