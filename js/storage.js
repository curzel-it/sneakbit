// Generic numeric key/value store, backed by localStorage. Mirrors the
// Rust game_core storage module: arbitrary string keys hold u32 values,
// and `keyMatches(key, expected)` is the gate used by dialogue conditions
// (and by equipment, after-dialogue tracking, etc).
//
// Values are coerced to integers on read/write. `null` (and absent) are
// the "unset" state — distinct from 0.

const PREFIX = "sneakbit.kv.v1.";

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

// Test-only: wipe in-memory cache without touching localStorage.
export function _resetStorageForTesting() {
  cache.clear();
  hydrated = true;
}
