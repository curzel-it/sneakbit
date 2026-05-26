// Creative-mode zone override store. Backed by IndexedDB so we can hold
// the full raw zone JSON (tile-string grids, entities, dialogue tables)
// — far larger than what `js/storage.js` (localStorage, u32-valued) is
// willing to hold.
//
// The buffer is consulted by `js/data.js::loadZone(id)` in creative
// mode: if an override is present, it's returned in place of the shipped
// `./data/{id}.json`. Non-creative play ignores the buffer entirely so
// authors can experiment without those edits leaking into a real
// player's session.
//
// API is intentionally minimal — get / put / clear by zone id, plus a
// listAll for the (future) editor sidebar. All three are async because
// IndexedDB itself is async; `loadZone` already awaits, so the round
// trip is invisible to callers.

const DB_NAME = "sneakbit.creative.v1";
const STORE = "zones";
const DB_VERSION = 1;

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB is not available"));
  }
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(mode) {
  return openDb().then((db) => db.transaction(STORE, mode).objectStore(STORE));
}

function asPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Returns the stored raw JSON for zone `id`, or null when nothing is
// buffered. Resolves to null (not throws) on IndexedDB errors so callers
// can treat absence and unavailability the same way.
export async function getBufferedZone(id) {
  try {
    const store = await tx("readonly");
    const raw = await asPromise(store.get(String(id)));
    return raw ?? null;
  } catch {
    return null;
  }
}

// Buffer a raw zone payload under `id`. Caller owns the lifetime of
// `raw` — we structured-clone it as IDB writes the value.
export async function putBufferedZone(id, raw) {
  const store = await tx("readwrite");
  return asPromise(store.put(raw, String(id)));
}

// Clear the override for a specific zone (the menu's "Reset zone"
// action). Subsequent loadZone(id) calls fall back to ./data/{id}.json.
export async function clearBufferedZone(id) {
  const store = await tx("readwrite");
  return asPromise(store.delete(String(id)));
}

// Returns the set of zone ids that currently have an override stored.
// Used by the editor sidebar / debug tooling; not in any hot path.
export async function listBufferedZones() {
  try {
    const store = await tx("readonly");
    const keys = await asPromise(store.getAllKeys());
    return Array.isArray(keys) ? keys.map(String) : [];
  } catch {
    return [];
  }
}
