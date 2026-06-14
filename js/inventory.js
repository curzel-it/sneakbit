// Per-player inventory: count of each pickup-able species id, keyed by
// player index. Mirrors Rust storage.rs: `player.{p}.inventory.amount.{sid}`.
//
// Single-player calls keep working unchanged — they default to index 0.
// Local co-op (one save slot) FOLDS P2 (index 1) onto P1 (index 0) so
// kunai pickups by either player feed a single shared pool. Network
// co-op leaves indices independent — guests own their own inventory.

import { getValue, setValue } from "./storage.js";
import { isCoopMode } from "./coopMode.js";
import { isTowerDefenseMode } from "./gameMode.js";

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

// Local co-op shares one save slot — both local heroes drop pickups
// into player.0.*. Single-player keeps its own index. Network co-op
// keeps slots independent: each guest owns its own pool, and the host
// reflects per-guest counts back over the wire (see hostInventorySync /
// guestEvents handlers). isCoopMode() distinguishes the two: it's true
// only for local co-op; isCoopActive() would also catch network co-op,
// which we deliberately exclude here.
function effectiveIndex(playerIndex) {
  const idx = playerIndex | 0;
  // Tower Defense keeps ammo per-hero (each hero loads its own weapon and
  // burns its own rounds), so it must NOT fold even in local co-op — unlike
  // the shared coin purse (wallet.js). The transient TD save (tdSave.js)
  // keeps these counts off the real inventory.
  if (idx > 0 && isCoopMode() && !isTowerDefenseMode()) return 0;
  return idx;
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

// Drop the in-memory counts and mark hydrated so the next access starts from
// an EMPTY pool without re-scanning the real localStorage. Used by tdSave when
// entering a transient Tower Defense run, so the squad begins with no carried
// ammo and the real inventory is never read or written for the rest of the run.
export function resetInventoryCache() {
  for (let i = 0; i < counts.length; i++) counts[i] = {};
  hydrated = true;
  for (const fn of listeners) for (let i = 0; i < counts.length; i++) fn(counts[i], i);
}

// Returns a shallow snapshot of a player's counts. Used by the inventory
// screen which renders a "pick up" list per player.
export function snapshotInventory(playerIndex = 0) {
  hydrate();
  return { ...(counts[effectiveIndex(playerIndex)] || {}) };
}
