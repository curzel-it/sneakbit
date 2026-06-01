// Generic numeric key/value store, backed by localStorage. Mirrors the
// Rust game_core storage module: arbitrary string keys hold u32 values,
// and `keyMatches(key, expected)` is the gate used by dialogue conditions
// (and by equipment, after-dialogue tracking, etc).
//
// Values are coerced to integers on read/write. `null` (and absent) are
// the "unset" state — distinct from 0.

const PREFIX = "sneakbit.kv.v1.";
const hasLS = typeof localStorage !== "undefined";

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

export function setValue(key, value) {
  hydrate();
  if (value == null) {
    cache.delete(key);
    if (hasLS) { try { localStorage.removeItem(PREFIX + key); } catch {} }
    notifyChange(key);
    return;
  }
  const v = value | 0;
  cache.set(key, v);
  if (hasLS) { try { localStorage.setItem(PREFIX + key, String(v)); } catch {} }
  notifyChange(key);
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
