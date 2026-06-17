// Per-player inventory: count of each pickup-able species id, keyed by
// player index. Mirrors Rust storage.rs: `player.{p}.inventory.amount.{sid}`.
//
// Every player owns a dedicated inventory — single-player and the host use
// index 0, local split-screen co-op uses indices 1..3 for P2..P4, and each
// online guest owns its own pool (mirrored from the host's authoritative
// copy at player.{slot-1}.*). No index is ever folded onto another: a kunai
// picked up by P2 lands in P2's pool, not a shared one.

import { getValue, setValue } from "./storage.js";

// In-memory mirror per player. Lazy-loaded once from storage on first
// access of any function. We snapshot from storage.js's cache rather
// than scanning localStorage directly, so the migration path stays
// neutral as schema versions roll forward.
const PLAYER_KEY_PREFIX = "player.";
const KEY_SUFFIX = ".inventory.amount.";
const MAX_PLAYERS = 4;

// counts[playerIndex] = { speciesId: count }
const counts = Array.from({ length: MAX_PLAYERS }, () => ({}));
let hydrated = false;
const listeners = new Set();

function hydrate() {
  if (hydrated) return;
  hydrated = true;
  if (typeof localStorage === "undefined") return;
  // Scan storage.js's prefix for any inventory.amount keys we previously
  // wrote. Falls back to nothing on first launch.
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      // Live storage keys are prefixed by `sneakbit.kv.v1.` (see storage.js).
      // Strip the prefix and check whether the inner key matches one of
      // our per-player slots.
      const dot = k.indexOf(".kv.v1.");
      if (dot < 0) continue;
      const inner = k.slice(dot + ".kv.v1.".length);
      const m = inner.match(/^player\.(\d+)\.inventory\.amount\.(\d+)$/);
      if (!m) continue;
      const idx = m[1] | 0;
      const sid = m[2] | 0;
      if (idx < 0 || idx >= MAX_PLAYERS) continue;
      const raw = localStorage.getItem(k);
      const n = Number(raw);
      if (Number.isFinite(n)) counts[idx][sid] = n | 0;
    }
  } catch {}
}

function key(playerIndex, speciesId) {
  return `${PLAYER_KEY_PREFIX}${playerIndex | 0}${KEY_SUFFIX}${speciesId | 0}`;
}

// Inventories are never folded: each player index addresses its own pool.
// (Kept as a named seam so the read/write paths below read uniformly and a
// future remap — e.g. PvP scratch pools — has one place to hook.)
function effectiveIndex(playerIndex) {
  return playerIndex | 0;
}

function persist(playerIndex, speciesId) {
  const idx = playerIndex | 0;
  const v = counts[idx][speciesId] | 0;
  setValue(key(idx, speciesId), v === 0 ? null : v);
  for (const fn of listeners) fn(counts[idx], idx);
}

export function getAmmo(speciesId, playerIndex = 0) {
  hydrate();
  const idx = effectiveIndex(playerIndex);
  return (counts[idx] || counts[0])[speciesId] | 0;
}

export function addAmmo(speciesId, amount = 1, playerIndex = 0) {
  if (!amount) return;
  hydrate();
  const idx = effectiveIndex(playerIndex);
  const bucket = counts[idx] || counts[0];
  bucket[speciesId] = (bucket[speciesId] | 0) + amount;
  persist(idx, speciesId);
}

export function removeAmmo(speciesId, amount = 1, playerIndex = 0) {
  hydrate();
  const idx = effectiveIndex(playerIndex);
  const bucket = counts[idx] || counts[0];
  const have = bucket[speciesId] | 0;
  if (have < amount) return false;
  bucket[speciesId] = have - amount;
  persist(idx, speciesId);
  return true;
}

export function onInventoryChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function clearInventory(playerIndex) {
  hydrate();
  const targets = playerIndex == null
    ? [...counts.keys()]
    : [effectiveIndex(playerIndex)];
  for (const idx of targets) {
    const bucket = counts[idx];
    if (!bucket) continue;
    const ids = Object.keys(bucket);
    counts[idx] = {};
    for (const sid of ids) setValue(key(idx, sid), null);
    for (const fn of listeners) fn(counts[idx], idx);
  }
}

// Returns a shallow snapshot of a player's counts. Used by the inventory
// screen which renders a "pick up" list per player.
export function snapshotInventory(playerIndex = 0) {
  hydrate();
  return { ...(counts[effectiveIndex(playerIndex)] || {}) };
}
