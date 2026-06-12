// Generic numeric key/value store, backed by localStorage. Mirrors the
// Rust game_core storage module: arbitrary string keys hold u32 values,
// and `keyMatches(key, expected)` is the gate used by dialogue conditions
// (and by equipment, after-dialogue tracking, etc).
//
// Values are coerced to integers on read/write. `null` (and absent) are
// the "unset" state — distinct from 0.

const PREFIX = "sneakbit.kv.v1.";

// Inventory counts live under `player.<p>.inventory.amount.<sid>`; a bare
// `inventory.amount.<sid>` dialogue gate is expanded across these slots (see
// getValue). Mirrors Rust storage.rs constants + MAX_PLAYERS.
const INVENTORY_AMOUNT = "inventory.amount";
const PLAYER_PREFIX = "player.";
const MAX_PLAYERS = 4;

// Probe for a *usable* localStorage, not just a present one. Node ≥25 exposes
// a stub `localStorage` whose `setItem` throws, and Safari private mode exposes
// one with a zero quota — in both, presence lies. A throwaway set/remove tells
// us whether writes actually land; if not, we degrade to the in-memory cache
// for the whole session rather than treating every write as a (false) failure.
function probeLocalStorage() {
  if (typeof localStorage === "undefined" || !localStorage) return false;
  try {
    const probe = PREFIX + "__probe__";
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    return true;
  } catch { return false; }
}
const hasLS = probeLocalStorage();

const cache = new Map();
let hydrated = false;
// Change subscribers — cloudSave listens here to know when progress (the
// kv.v1 namespace) changed, so it can debounce a cloud push. Kept as a
// passive notify so storage.js takes on no dependency on the sync layer.
const changeSubscribers = new Set();

export function onStorageChange(fn) {
  changeSubscribers.add(fn);
  return () => changeSubscribers.delete(fn);
}

function notifyChange(key) {
  for (const fn of changeSubscribers) {
    try { fn(key); } catch (e) { console.error("onStorageChange handler", e); }
  }
}

function hydrate() {
  if (hydrated) return;
  hydrated = true;
  if (!hasLS) return;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(PREFIX)) continue;
      const raw = localStorage.getItem(k);
      if (raw == null) continue;
      const n = Number(raw);
      if (Number.isFinite(n)) cache.set(k.slice(PREFIX.length), n | 0);
    }
  } catch {}
}

export function getValue(key) {
  hydrate();
  if (typeof key === "string") {
    // A player-agnostic `inventory.amount.<sid>` gate resolves to the first
    // local player who holds that item, mirroring Rust
    // storage.rs::get_value_for_global_key. Inventory counts are stored
    // per-player (`player.<p>.inventory.amount.<sid>`), so without this the
    // bare form never matches and the dialogue/lore lines gated on it are
    // unreachable. The explicit `player.N.…` form skips this and reads direct.
    if (key.includes(INVENTORY_AMOUNT) && !key.includes(PLAYER_PREFIX)) {
      for (let p = 0; p < MAX_PLAYERS; p++) {
        const v = getValue(`${PLAYER_PREFIX}${p}.${key}`);
        if (v !== null) return v;
      }
      return null;
    }
    // Comma-joined keys are a multi-condition gate, ported from the same Rust
    // function: resolve every sub-key and return the value they ALL share, or
    // null when they disagree. Paired with keyMatches' `stored === expected`
    // test this yields AND semantics — the gate holds only when every sub-key
    // equals the expected value. Dialogue data relies on it for "the player
    // asked about both ninjas" and "quest started AND item collected"; without
    // it those lines were dead and the branches unreachable.
    if (key.includes(",")) {
      const values = new Set(
        key.split(",").filter((k) => k !== "").map((k) => getValue(k)),
      );
      return values.size === 1 ? values.values().next().value : null;
    }
  }
  return cache.has(key) ? cache.get(key) : null;
}

// Returns true if the value was persisted (disk write succeeded, or we're in
// the in-memory-only fallback), false if the disk write threw (quota / Safari
// private mode). The cache is updated *only* on success, so it never diverges
// from disk into a "looks saved but isn't" state — the illusion that let a
// failed migration write silently drop a save (see migrations.js v3).
export function setValue(key, value) {
  hydrate();
  if (value == null) {
    if (hasLS) {
      try { localStorage.removeItem(PREFIX + key); }
      catch (e) { console.error("storage removeItem failed", e); return false; }
    }
    cache.delete(key);
    notifyChange(key);
    return true;
  }
  const v = value | 0;
  if (hasLS) {
    try { localStorage.setItem(PREFIX + key, String(v)); }
    catch (e) { console.error("storage setItem failed; cache left unchanged", e); return false; }
  }
  cache.set(key, v);
  notifyChange(key);
  return true;
}

// True if `key` matches `expectedValue` under the Rust core's rule:
//   - key == "always" → always true
//   - stored value === expected → true
//   - expected === 0 AND no stored value → true (treat unset as zero)
export function keyMatches(key, expectedValue) {
  if (!key || key === "always") return true;
  const stored = getValue(key);
  const ev = expectedValue | 0;
  if (stored === ev) return true;
  if (ev === 0 && stored === null) return true;
  return false;
}

// Snapshot the entire kv namespace into a plain object. Used by the
// autoplay bot to dry-run the route planner (which writes flags as it
// simulates) against a COPY of the live save without mutating it. Pairs
// with restoreStorage.
export function snapshotStorage() {
  hydrate();
  const snap = {};
  for (const [k, v] of cache) snap[k] = v;
  return snap;
}

// Restore the kv namespace to a prior snapshotStorage() result, in both
// the in-memory cache and the localStorage backing store, so a dry-run
// that wrote flags leaves no trace on the real save. Keys present now but
// absent from the snapshot are cleared; changed keys are rewritten. Goes
// through setValue so localStorage stays in lockstep and change
// subscribers (cloudSave) see the restored final state.
export function restoreStorage(snap) {
  hydrate();
  const keys = new Set([...cache.keys(), ...Object.keys(snap || {})]);
  for (const k of keys) {
    const want = snap && Object.prototype.hasOwnProperty.call(snap, k) ? snap[k] : null;
    const have = cache.has(k) ? cache.get(k) : null;
    if (want === have) continue;
    setValue(k, want);
  }
}

// Test-only: wipe in-memory cache without touching localStorage.
export function _resetStorageForTesting() {
  cache.clear();
  hydrated = true;
}
