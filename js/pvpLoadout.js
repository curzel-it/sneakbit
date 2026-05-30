// Per-player PvP loadout: the equipped ranged weapon plus a per-caliber
// ammo count, for each player. In-memory and non-persisted, reset every
// match, so PvP never touches the saved inventory/equipment (local co-op's
// shared fold and online's per-playerId pools are left alone).
//
// Players spawn with only the kunai launcher and zero ammo, then scavenge
// the arena: ammo crates fill the matching caliber, weapon crates swap the
// equipped weapon (see pickups.js). Each caliber (kunai 7000, .223 1169,
// cannon 1170, …) is tracked independently by its bullet species id.

const MAX_PLAYERS = 4;

// Everyone starts with the kunai launcher equipped (its bullet is 7000).
export const PVP_DEFAULT_RANGED = 1160;

// ammo[playerIndex] = { [bulletSpeciesId]: count }
const ammo = Array.from({ length: MAX_PLAYERS }, () => Object.create(null));
const ranged = new Array(MAX_PLAYERS).fill(PVP_DEFAULT_RANGED);
const listeners = new Set();

// Wipe ammo and re-equip the default weapon for everyone. Match start / rematch.
export function resetPvpLoadout() {
  for (let i = 0; i < MAX_PLAYERS; i++) {
    ammo[i] = Object.create(null);
    ranged[i] = PVP_DEFAULT_RANGED;
  }
  notify();
}

export function getPvpRangedWeapon(index = 0) {
  return ranged[index | 0] ?? PVP_DEFAULT_RANGED;
}

export function setPvpRangedWeapon(index, weaponId) {
  const i = index | 0;
  if (i < 0 || i >= MAX_PLAYERS || !weaponId) return;
  ranged[i] = weaponId;
  notify();
}

export function getPvpAmmo(index, bulletId) {
  const i = index | 0;
  if (i < 0 || i >= MAX_PLAYERS) return 0;
  return ammo[i][bulletId | 0] | 0;
}

export function hasPvpAmmo(index, bulletId) {
  return getPvpAmmo(index, bulletId) > 0;
}

// Set a player's count for one caliber to an absolute value (guests mirror
// the host's authoritative pool over the wire — see guestSelfHpSync).
export function setPvpAmmo(index, bulletId, count) {
  const i = index | 0;
  const b = bulletId | 0;
  if (i < 0 || i >= MAX_PLAYERS || !b) return;
  ammo[i][b] = Math.max(0, count | 0);
  notify();
}

// Grant ammo of one caliber to a player (map pickups).
export function addPvpAmmo(index, bulletId, amount) {
  const i = index | 0;
  const b = bulletId | 0;
  const n = amount | 0;
  if (i < 0 || i >= MAX_PLAYERS || !b || n <= 0) return;
  ammo[i][b] = (ammo[i][b] | 0) + n;
  notify();
}

// Consume one round of the given caliber; false (and no change) when empty.
export function spendPvpAmmo(index, bulletId) {
  const i = index | 0;
  const b = bulletId | 0;
  if ((ammo[i]?.[b] | 0) <= 0) return false;
  ammo[i][b] -= 1;
  notify();
  return true;
}

export function onPvpLoadoutChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  for (const fn of listeners) fn();
}
