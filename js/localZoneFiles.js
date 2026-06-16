// Local zone-file writer for creative mode.
//
// Creative mode is a local-only authoring tool (see creativeMode.js — it only
// activates on localhost). Instead of a server round-trip, edits are written
// straight into this repo's data/<id>.json via the browser File System Access
// API: the author grants the repo's data/ folder once ("Connect data/ folder…"
// in the Creative menu) and from then on every edit is saved to disk.
//
// The granted directory handle is persisted in IndexedDB so it survives
// reloads — browsers may still require a one-click permission re-grant, which
// the Connect button provides. Loads don't go through here: data.js fetches
// ./data/<id>.json directly, which (served from the same folder) already
// reflects what we wrote.
//
// Chromium-only: Firefox/Safari lack showDirectoryPicker, so connect reports
// "unsupported" and writes no-op. In-memory editing still works there.

const IDB_NAME = "sneakbit-creative";
const IDB_STORE = "handles";
const HANDLE_KEY = "dataDir";
const WRITE_DEBOUNCE_MS = 300;

let dirHandle = null; // FileSystemDirectoryHandle once connected + permitted.
const pending = new Map(); // id -> { raw, timer } debounced writes in flight.

export function isFileSystemAccessSupported() {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}

// --- IndexedDB: a single persisted directory handle -----------------------

function idbOpen() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("no-indexeddb")); return; }
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(key, value) {
  return idbOpen().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => { db.close(); resolve(true); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  }));
}

function idbGet(key) {
  return idbOpen().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => { db.close(); resolve(req.result ?? null); };
    req.onerror = () => { db.close(); reject(req.error); };
  }));
}

// --- Permission helpers ---------------------------------------------------

async function ensurePermission(handle, { prompt } = {}) {
  if (!handle?.queryPermission) return true; // older impls grant implicitly
  const opts = { mode: "readwrite" };
  if ((await handle.queryPermission(opts)) === "granted") return true;
  if (prompt && handle.requestPermission) {
    return (await handle.requestPermission(opts)) === "granted";
  }
  return false;
}

// --- Public API -----------------------------------------------------------

export function isDataDirConnected() {
  return !!dirHandle;
}

// On boot, re-adopt the previously granted folder if the permission is still
// live (no user gesture available here, so we only query, never prompt).
export async function restoreDataDir() {
  if (!isFileSystemAccessSupported()) return false;
  try {
    const saved = await idbGet(HANDLE_KEY);
    if (!saved) return false;
    if (await ensurePermission(saved, { prompt: false })) {
      dirHandle = saved;
      return true;
    }
  } catch { /* fall through — author can reconnect manually */ }
  return false;
}

// Prompt for the data/ folder. MUST be called from a user gesture (a button
// click). Returns { ok, name, reason }.
export async function connectDataDir() {
  if (!isFileSystemAccessSupported()) {
    return { ok: false, reason: "File System Access is unsupported — use Chrome or Edge locally." };
  }
  let handle;
  try {
    handle = await window.showDirectoryPicker({ id: "sneakbit-data", mode: "readwrite" });
  } catch (e) {
    // AbortError = the author dismissed the picker; not an error worth shouting.
    if (e?.name === "AbortError") return { ok: false, reason: "Folder selection cancelled." };
    return { ok: false, reason: e?.message ?? "Could not open the folder picker." };
  }
  if (!(await ensurePermission(handle, { prompt: true }))) {
    return { ok: false, reason: "Read-write permission was not granted." };
  }
  dirHandle = handle;
  try { await idbPut(HANDLE_KEY, handle); } catch { /* persistence is best-effort */ }
  return { ok: true, name: handle.name };
}

async function writeNow(id, raw) {
  if (!dirHandle) return false;
  try {
    const file = await dirHandle.getFileHandle(`${id}.json`, { create: true });
    const writable = await file.createWritable();
    await writable.write(JSON.stringify(raw, null, 2) + "\n");
    await writable.close();
    return true;
  } catch (e) {
    console.warn(`creative: failed to write data/${id}.json`, e);
    return false;
  }
}

// Debounced write — coalesces the rapid per-tile flushes the map editor fires
// while painting. Safe to call when disconnected (no-op).
export function writeZoneFile(id, raw) {
  if (!dirHandle) return;
  const existing = pending.get(id);
  if (existing) clearTimeout(existing.timer);
  const timer = setTimeout(() => {
    const entry = pending.get(id);
    pending.delete(id);
    if (entry) writeNow(id, entry.raw);
  }, WRITE_DEBOUNCE_MS);
  pending.set(id, { raw, timer });
}

// Immediate write, awaiting the result — for the Save button and the
// flush-on-teleport path where we want the bytes on disk before moving on.
export async function flushZoneFile(id, raw) {
  const existing = pending.get(id);
  if (existing) { clearTimeout(existing.timer); pending.delete(id); }
  return writeNow(id, raw);
}
