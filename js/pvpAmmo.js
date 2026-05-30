// Per-player ammo for a PvP match. Deliberately separate from inventory.js:
// the story inventory persists to localStorage (per-index), so seeding it
// for PvP would corrupt P1's real save and leak into the next session.
// This store is in-memory only and reset every match, so each player gets
// their own finite, fair stock without touching saved progress.
//
// Uniform-weapon model: in PvP all players fire the same (folded) weapon,
// so a single shots-remaining counter per player is enough — no need to
// key by bullet species. Local co-op and online co-op keep using
// inventory.js exactly as before; this is only consulted when isPvp().

const MAX_PLAYERS = 4;

// Kunai per player at the start of a match. Finite so ranged is a managed
// resource; melee (no ammo) is the fallback when a player runs dry.
export const PVP_STARTING_AMMO = 30;

const ammo = new Array(MAX_PLAYERS).fill(0);
const listeners = new Set();

// Seed players 0..n-1 with the starting stock; clear the rest. Called on
// match start and on rematch.
export function resetPvpAmmo(n) {
  const count = Math.max(0, Math.min(MAX_PLAYERS, n | 0));
  for (let i = 0; i < MAX_PLAYERS; i++) ammo[i] = i < count ? PVP_STARTING_AMMO : 0;
  notify();
}

export function getPvpAmmo(index = 0) {
  return ammo[index | 0] | 0;
}

export function hasPvpAmmo(index = 0) {
  return (ammo[index | 0] | 0) > 0;
}

// Consume one shot for the player; returns false (and changes nothing) when
// empty, so the caller can play the no-ammo cue.
export function spendPvpAmmo(index = 0) {
  const i = index | 0;
  if ((ammo[i] | 0) <= 0) return false;
  ammo[i] = ammo[i] - 1;
  notify();
  return true;
}

export function onPvpAmmoChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  for (const fn of listeners) fn();
}
