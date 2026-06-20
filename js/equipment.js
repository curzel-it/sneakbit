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

// Armour slots, mirroring the doom build: three independent body pieces, each
// holding one Armour species id. Their damage reductions stack multiplicatively
// in playerHealth.js, exactly like a weapon's received_damage_reduction.
export const SLOT_HELMET = "helmet";
export const SLOT_CHEST  = "chest";
export const SLOT_LEGS   = "legs";
export const ARMOR_SLOTS = [SLOT_HELMET, SLOT_CHEST, SLOT_LEGS];

// Every persisted equipment slot. Ranged carries an implicit default; all
// others default to empty (null).
const EQUIP_SLOTS = new Set([SLOT_RANGED, SLOT_MELEE, ...ARMOR_SLOTS]);

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
  if (!EQUIP_SLOTS.has(slot)) return null;
  const idx = effectiveIndex(index);
  const v = getValue(keyFor(slot, idx));
  if (slot === SLOT_RANGED) return v == null ? DEFAULT_RANGED_WEAPON_ID : v;
  return v == null ? null : v;
}

export function setEquipped(slot, speciesId, index = 0) {
  if (!EQUIP_SLOTS.has(slot)) return;
  const idx = effectiveIndex(index);
  setValue(keyFor(slot, idx), speciesId);
  for (const fn of listeners) fn(slot, speciesId, idx);
}

export function clearEquipped(slot, index = 0) {
  if (!EQUIP_SLOTS.has(slot)) return;
  const idx = effectiveIndex(index);
  setValue(keyFor(slot, idx), null);
  for (const fn of listeners) fn(slot, null, idx);
}

// The full equipment snapshot for a player, in the shape the loadout wire
// protocol and resolveLoadout use: weapons as scalar ids, armour as a
// slot-keyed object. Ranged falls back to its implicit default; every other
// slot is null when empty.
export function snapshotEquipment(index = 0) {
  return {
    melee: getEquipped(SLOT_MELEE, index),
    ranged: getEquipped(SLOT_RANGED, index),
    armor: armorFromEquipment(index),
  };
}

function armorFromEquipment(index) {
  const armor = {};
  for (const slot of ARMOR_SLOTS) armor[slot] = getEquipped(slot, index);
  return armor;
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
    snapshot: snapshotEquipment,
    SLOT_RANGED,
    SLOT_MELEE,
    SLOT_HELMET,
    SLOT_CHEST,
    SLOT_LEGS,
    ARMOR_SLOTS,
  };
}
