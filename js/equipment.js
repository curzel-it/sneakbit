// Tracks each player's currently-equipped melee and ranged weapons.
// Mirrors Rust equipment/basics.rs: per-player slot, stored as the weapon
// species id, with keys `player.{p}.equipped.{slot}.weapon`.
// Default ranged = kunai launcher (1160) per player; default melee = none.
// Exposes `window.equipment` for devtools (parity with window.skills).

import { getValue, setValue } from "./storage.js";

export const SLOT_RANGED = "ranged";
export const SLOT_MELEE  = "melee";

export const DEFAULT_RANGED_WEAPON_ID = 1160; // kunai launcher

const listeners = new Set();

function keyFor(slot, index) {
  const i = (index | 0);
  return `player.${i}.equipped.${slot}`;
}

export function getEquipped(slot, index = 0) {
  if (slot === SLOT_RANGED) {
    const v = getValue(keyFor(SLOT_RANGED, index));
    return v == null ? DEFAULT_RANGED_WEAPON_ID : v;
  }
  if (slot === SLOT_MELEE) {
    const v = getValue(keyFor(SLOT_MELEE, index));
    return v == null ? null : v;
  }
  return null;
}

export function setEquipped(slot, speciesId, index = 0) {
  if (slot !== SLOT_RANGED && slot !== SLOT_MELEE) return;
  setValue(keyFor(slot, index), speciesId);
  for (const fn of listeners) fn(slot, speciesId, index | 0);
}

export function clearEquipped(slot, index = 0) {
  if (slot !== SLOT_RANGED && slot !== SLOT_MELEE) return;
  setValue(keyFor(slot, index), null);
  for (const fn of listeners) fn(slot, null, index | 0);
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
