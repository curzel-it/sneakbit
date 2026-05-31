// Lock primitives shared by gates, pressure plates, and keys.
// Lock-type strings match the data files (case-insensitive); pressure-plate
// storage keys match the Rust core's `pressure_plate_down_<color>`.

import { getValue, setValue } from "./storage.js";

export const LOCK_NONE      = "None";
export const LOCK_YELLOW    = "Yellow";
export const LOCK_RED       = "Red";
export const LOCK_BLUE      = "Blue";
export const LOCK_GREEN     = "Green";
export const LOCK_SILVER    = "Silver";
export const LOCK_PERMANENT = "Permanent";

const ALL_COLORED = [LOCK_YELLOW, LOCK_RED, LOCK_BLUE, LOCK_GREEN, LOCK_SILVER];

const LOCK_TO_KEY_SPECIES = {
  [LOCK_YELLOW]: 2000,
  [LOCK_RED]:    2001,
  [LOCK_GREEN]:  2002,
  [LOCK_BLUE]:   2003,
  [LOCK_SILVER]: 2004,
};

export function canonicaliseLock(name) {
  if (!name) return LOCK_NONE;
  const lower = String(name).toLowerCase();
  switch (lower) {
    case "yellow":    return LOCK_YELLOW;
    case "red":       return LOCK_RED;
    case "blue":      return LOCK_BLUE;
    case "green":     return LOCK_GREEN;
    case "silver":    return LOCK_SILVER;
    case "permanent": return LOCK_PERMANENT;
    default:          return LOCK_NONE;
  }
}

export function keySpeciesIdForLock(lock) {
  return LOCK_TO_KEY_SPECIES[canonicaliseLock(lock)] ?? null;
}

export function isColoredLock(lock) {
  return ALL_COLORED.includes(canonicaliseLock(lock));
}

function plateKey(lock) {
  return `pressure_plate_down_${canonicaliseLock(lock).toLowerCase()}`;
}

export function isPressurePlateDown(lock) {
  const l = canonicaliseLock(lock);
  if (l === LOCK_NONE || l === LOCK_PERMANENT) return false;
  return getValue(plateKey(l)) === 1;
}

export function setPressurePlateDown(lock, down) {
  const l = canonicaliseLock(lock);
  if (l === LOCK_NONE || l === LOCK_PERMANENT) return;
  setValue(plateKey(l), down ? 1 : 0);
}

export function loadLockOverride(entityId) {
  const v = getValue(`lock_override.${entityId}`);
  if (v == null) return null;
  // Storage stores the lock as a small int matching Rust's LockType::as_int.
  return INT_TO_LOCK[v] ?? null;
}

export function saveLockOverride(entityId, lock) {
  const l = canonicaliseLock(lock);
  setValue(`lock_override.${entityId}`, LOCK_TO_INT[l]);
}

const LOCK_TO_INT = {
  [LOCK_NONE]:      0,
  [LOCK_YELLOW]:    1,
  [LOCK_RED]:       2,
  [LOCK_BLUE]:      3,
  [LOCK_GREEN]:     4,
  [LOCK_SILVER]:    5,
  [LOCK_PERMANENT]: 6,
};

const INT_TO_LOCK = [
  LOCK_NONE, LOCK_YELLOW, LOCK_RED, LOCK_BLUE,
  LOCK_GREEN, LOCK_SILVER, LOCK_PERMANENT,
];
