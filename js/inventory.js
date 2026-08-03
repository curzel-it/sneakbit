// Per-player inventory: count of each pickup-able species id, keyed by
// player index. Mirrors Rust storage.rs: `player.{p}.inventory.amount.{sid}`.
//
// Every player owns a dedicated inventory — single-player and the host use
// index 0, local split-screen co-op uses indices 1..3 for P2..P4, and each
// online guest owns its own pool (mirrored from the host's authoritative
// copy at player.{slot-1}.*). No index is ever folded onto another: a kunai
// picked up by P2 lands in P2's pool, not a shared one.

import { setValue, snapshotStorage, onStorageChange } from "./storage.js";

// In-memory mirror per player, derived from storage.js — never from a direct
// localStorage scan. Two things used to make items vanish:
//
//   * a private localStorage scan meant any write that went through
//     setValue() instead of addAmmo() — the v2 migration fanning out the
//     legacy blob, a restoreStorage, a cloud pull — left this cache stale.
//     The next addAmmo then wrote `stale + 1` back over the good value,
//     silently dropping whatever the other writer had put there.
//   * setValue can FAIL (quota, Safari private mode). The bucket was already
//     mutated by then, so the session showed items that never reached disk
//     and were gone on reload.
//
// Now the cache is rebuilt from storage.js's own view, invalidated whenever
// anyone else writes an inventory key, and a failed persist rolls the
// in-memory count back so what you see is always what's on disk.
const PLAYER_KEY_PREFIX = "player.";
const KEY_SUFFIX = ".inventory.amount.";
const MAX_PLAYERS = 4;
const KEY_RE = /^player\.(\d+)\.inventory\.amount\.(\d+)$/;

// counts[playerIndex] = { speciesId: count }
let counts = Array.from({ length: MAX_PLAYERS }, () => ({}));
let hydrated = false;
const listeners = new Set();
// Set while persist() is writing, so the storage-change subscription below
// doesn't invalidate the cache in response to our own write.
let writing = false;

// Any inventory write that didn't come from this module invalidates the
// cache; the next read re-derives it from storage. Cheap — inventory keys are
// a small slice of the change stream and a re-hydrate is one map walk.
onStorageChange((key) => {
  if (writing) return;
  if (typeof key === "string" && !KEY_RE.test(key)) return;
  hydrated = false;
});

function hydrate() {
  if (hydrated) return;
  hydrated = true;
  counts = Array.from({ length: MAX_PLAYERS }, () => ({}));
  // storage.js is the single source of truth for the kv namespace: it owns
  // the localStorage prefix, the int coercion, and the in-memory fallback
  // when localStorage is unusable.
  const snap = snapshotStorage();
  for (const [inner, value] of Object.entries(snap)) {
    const m = KEY_RE.exec(inner);
    if (!m) continue;
    const idx = m[1] | 0;
    const sid = m[2] | 0;
    if (idx < 0 || idx >= MAX_PLAYERS) continue;
    if (Number.isFinite(value)) counts[idx][sid] = value | 0;
  }
}

function key(playerIndex, speciesId) {
  return `${PLAYER_KEY_PREFIX}${playerIndex | 0}${KEY_SUFFIX}${speciesId | 0}`;
}

// Inventories are never folded: each player index addresses its own pool.
// (Kept as a named seam so the read/write paths below read uniformly and a
// future remap has one place to hook.)
function effectiveIndex(playerIndex) {
  return playerIndex | 0;
}

// Write one species count through to storage. Returns false — and rolls the
// in-memory count back to `previous` — when the disk write failed, so the
// cache can never claim items the save doesn't have.
function persist(playerIndex, speciesId, previous) {
  const idx = playerIndex | 0;
  const v = counts[idx][speciesId] | 0;
  writing = true;
  let ok;
  try { ok = setValue(key(idx, speciesId), v === 0 ? null : v); }
  finally { writing = false; }
  if (!ok) {
    if (previous === 0) delete counts[idx][speciesId];
    else counts[idx][speciesId] = previous;
    return false;
  }
  for (const fn of listeners) fn(counts[idx], idx);
  return true;
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
  const have = bucket[speciesId] | 0;
  bucket[speciesId] = have + amount;
  persist(idx, speciesId, have);
}

export function removeAmmo(speciesId, amount = 1, playerIndex = 0) {
  hydrate();
  const idx = effectiveIndex(playerIndex);
  const bucket = counts[idx] || counts[0];
  const have = bucket[speciesId] | 0;
  if (have < amount) return false;
  bucket[speciesId] = have - amount;
  return persist(idx, speciesId, have);
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
    writing = true;
    try { for (const sid of ids) setValue(key(idx, sid), null); }
    finally { writing = false; }
    for (const fn of listeners) fn(counts[idx], idx);
  }
}

// Returns a shallow snapshot of a player's counts. Used by the inventory
// screen which renders a "pick up" list per player.
export function snapshotInventory(playerIndex = 0) {
  hydrate();
  return { ...(counts[effectiveIndex(playerIndex)] || {}) };
}
