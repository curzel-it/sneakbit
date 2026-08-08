// A copy of the save in a real file, on the native shells only.
//
// Inside Steam/iOS/Android the game's one and only save lives in the WebView's
// localStorage — an opaque store keyed by the page origin, with no recovery if
// it's ever cleared or corrupted. The Rust build this one replaces wrote a
// plain JSON file, and players carry saves that are years old and have never
// been backed up anywhere (the old game had no accounts and no cloud). So the
// shell keeps a mirror on disk, and a boot that finds localStorage empty
// restores from it.
//
// It is a safety net, not a second source of truth: localStorage stays
// authoritative, the mirror only ever follows it, and a boot with any local
// progress ignores the mirror entirely.
//
// The payload is saveBlob's envelope — the same bytes cloudSave syncs — so
// there's one serialization format and one set of round-trip tests. Per-device
// settings (volumes, FPS counter, touch controls) are excluded there and stay
// excluded here; losing a volume slider is not what this is protecting against.

import { onStorageChange } from "./storage.js";
import { onBindingsChange } from "./keyBindings.js";
import { onGamepadBindingsChange } from "./gamepadBindings.js";
import { serializeBlob, applyBlob, hasLocalProgress } from "./saveBlob.js";
import { isNativeShell, getNativeState, writeMirror } from "./nativeBridge.js";

// Long enough to coalesce a burst (a zone transition writes a dozen keys),
// short enough that a hard kill loses at most a couple of seconds of play.
const DEBOUNCE_MS = 2000;

let installed = false;
let timer = null;
let lastWritten = null;

// True when the blob carries an actual save rather than an empty shell — the
// same `latest_zone` test hasLocalProgress() applies to localStorage.
function blobHasProgress(blob) {
  return !!blob && typeof blob === "object" && blob.kv && blob.kv.latest_zone != null;
}

// Boot step, before anything reads storage. Returns true when a reload is in
// flight (the caller must stop building state), matching bootRestoreFromCloud's
// contract. We reload rather than continue inline because applyBlob writes
// localStorage directly, bypassing the in-memory caches in storage.js /
// keyBindings / settings — only a fresh boot rehydrates every module off the
// restored save. It happens under the loading screen, so nothing flashes.
export async function restoreFromNativeMirror() {
  const native = getNativeState();
  if (!native || !blobHasProgress(native.mirror)) return false;
  // localStorage wins whenever it has anything. The mirror is for the case
  // where it has nothing at all.
  if (hasLocalProgress()) return false;

  try {
    applyBlob(native.mirror);
  } catch (e) {
    console.error("[saveMirror] restore failed", e);
    return false;
  }
  console.log("[saveMirror] restored the save from the native mirror");
  location.reload();
  return true;
}

function write({ keepalive = false } = {}) {
  let blob;
  try { blob = serializeBlob(); } catch { return; }
  // Never mirror an empty save over a real one. A boot that hasn't built state
  // yet, or a page mid-wipe, would otherwise erase the backup.
  if (!blobHasProgress(blob)) return;
  const text = JSON.stringify(blob);
  if (text === lastWritten) return;
  if (writeMirror(text, { keepalive })) lastWritten = text;
}

function schedule() {
  if (timer !== null) return;
  timer = setTimeout(() => { timer = null; write(); }, DEBOUNCE_MS);
}

function flush({ keepalive = false } = {}) {
  if (timer !== null) { clearTimeout(timer); timer = null; }
  write({ keepalive });
}

export function installSaveMirror() {
  if (installed || !isNativeShell()) return;
  installed = true;
  onStorageChange(schedule);
  onBindingsChange(schedule);
  onGamepadBindingsChange(schedule);
  if (typeof window !== "undefined") {
    // pagehide fires on iOS where beforeunload often doesn't (a swipe to the
    // home screen never "unloads"); listen for both and let the no-change
    // guard in write() collapse the duplicate.
    window.addEventListener("pagehide", () => flush({ keepalive: true }));
    window.addEventListener("beforeunload", () => flush({ keepalive: true }));
    // Debug / e2e hook, mirroring window.save and window.cloudSave.
    window.saveMirror = { flush: () => flush(), clear: () => clearMirror() };
  }
}

// Drop the mirror. Required by "New game": that clears latest_zone but leaves
// the mirror holding the whole save, so the next boot would see "no local
// progress", restore it, and hand the player back the game they just deleted.
// "Clear cache" deliberately does NOT call this — restoring the save there is
// the entire point of having a mirror.
export function clearMirror() {
  if (timer !== null) { clearTimeout(timer); timer = null; }
  lastWritten = null;
  if (!isNativeShell()) return;
  // An empty envelope rather than a delete: the shells only ever have to
  // implement one write path, and a truncated file reads back as "no mirror"
  // through blobHasProgress either way.
  //
  // keepalive because every caller reloads the page immediately afterwards. On
  // Electron this is a fetch, and the navigation would cancel it in flight —
  // leaving the mirror holding the save the player just deleted.
  writeMirror(JSON.stringify({ v: 1, kv: {}, bindings: {}, language: null }), { keepalive: true });
}

// Test-only.
export function _resetSaveMirrorForTesting() {
  if (timer !== null) { clearTimeout(timer); timer = null; }
  installed = false;
  lastWritten = null;
}
