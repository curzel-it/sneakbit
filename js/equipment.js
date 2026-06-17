// Tracks each player's currently-equipped melee and ranged weapons.
// Mirrors Rust equipment/basics.rs: per-player slot, stored as the weapon
// species id, with keys `player.{p}.equipped.{slot}.weapon`.
// Default ranged = kunai launcher (1160) per player; default melee = none.
// Every player carries a dedicated loadout — local split-screen co-op uses
// indices 1..3 for P2..P4, online guests own their own (synced via
// sessionLoadouts). No index is folded onto another.
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

// Loadouts are never folded: each player index addresses its own slots.
// Mirrors inventory.js / wallet.js effectiveIndex.
function effectiveIndex(index) {
  return index | 0;
}

export function getEquipped(slot, index = 0) {
  const idx = effectiveIndex(index);
  if (slot === SLOT_RANGED) {
    const v = getValue(keyFor(SLOT_RANGED, idx));
    return v == null ? DEFAULT_RANGED_WEAPON_ID : v;
  }
  if (slot === SLOT_MELEE) {
    const v = getValue(keyFor(SLOT_MELEE, idx));
    return v == null ? null : v;
  }
  return null;
}

export function setEquipped(slot, speciesId, index = 0) {
  if (slot !== SLOT_RANGED && slot !== SLOT_MELEE) return;
  const idx = effectiveIndex(index);
  setValue(keyFor(slot, idx), speciesId);
  for (const fn of listeners) fn(slot, speciesId, idx);
}

export function clearEquipped(slot, index = 0) {
  if (slot !== SLOT_RANGED && slot !== SLOT_MELEE) return;
  const idx = effectiveIndex(index);
  setValue(keyFor(slot, idx), null);
  for (const fn of listeners) fn(slot, null, idx);
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
