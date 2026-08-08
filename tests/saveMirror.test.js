// The native save mirror: the copy of the save that lives in a real file
// inside the Steam/iOS/Android shells, so a cleared or corrupted WebView store
// isn't the end of a playthrough.
//
// The fakes must be installed BEFORE importing anything that touches them:
// storage.js probes localStorage once at load, and nativeBridge caches the
// shell envelope. Each test file is its own node process, so these globals
// don't leak into the other suites.

import { test } from "node:test";
import assert from "node:assert/strict";

function makeFakeLocalStorage() {
  const store = new Map();
  return {
    get length() { return store.size; },
    key(i) { return [...store.keys()][i] ?? null; },
    getItem(k) { return store.has(k) ? store.get(k) : null; },
    setItem(k, v) { store.set(k, String(v)); },
    removeItem(k) { store.delete(k); },
    clear() { store.clear(); },
    _store: store,
  };
}

const fakeLS = makeFakeLocalStorage();
globalThis.localStorage = fakeLS;

// The Android write channel is a plain synchronous call, which makes it the
// easiest of the three to assert against.
const writes = [];
globalThis.SneakBitNative = { writeMirror(text) { writes.push(text); } };

let reloads = 0;
globalThis.location = { reload() { reloads++; }, pathname: "/" };
globalThis.window = { addEventListener() {} };

const KV = "sneakbit.kv.v1.";

const { _resetNativeBridgeForTesting } = await import("../js/nativeBridge.js");
const {
  restoreFromNativeMirror, installSaveMirror, clearMirror, _resetSaveMirrorForTesting,
} = await import("../js/saveMirror.js");

const MIRROR = {
  v: 1,
  kv: { latest_zone: "1011", "player.0.inventory.amount.7000": "12" },
  bindings: {},
  language: "it",
};

function reset({ native = { platform: "android", mirror: null, legacy: null } } = {}) {
  fakeLS.clear();
  writes.length = 0;
  reloads = 0;
  delete globalThis.window.saveMirror;
  _resetSaveMirrorForTesting();
  _resetNativeBridgeForTesting(native);
}

// — restore ————————————————————————————————————————————————————————————————

test("an empty localStorage is refilled from the mirror", async () => {
  reset({ native: { platform: "android", mirror: MIRROR, legacy: null } });

  assert.equal(await restoreFromNativeMirror(), true, "caller must stop and let the reload happen");
  assert.equal(reloads, 1);
  assert.equal(fakeLS.getItem(KV + "latest_zone"), "1011");
  assert.equal(fakeLS.getItem(KV + "player.0.inventory.amount.7000"), "12");
});

test("localStorage wins whenever it has a save of its own", async () => {
  reset({ native: { platform: "android", mirror: MIRROR, legacy: null } });
  fakeLS.setItem(KV + "latest_zone", "1001");

  assert.equal(await restoreFromNativeMirror(), false);
  assert.equal(reloads, 0);
  assert.equal(fakeLS.getItem(KV + "latest_zone"), "1001", "the live save is never overwritten");
});

test("an empty mirror is not a save", async () => {
  const empty = { v: 1, kv: {}, bindings: {}, language: null };
  reset({ native: { platform: "android", mirror: empty, legacy: null } });

  assert.equal(await restoreFromNativeMirror(), false);
  assert.equal(reloads, 0);
});

test("off the native shells there is nothing to restore from", async () => {
  reset({ native: null });
  assert.equal(await restoreFromNativeMirror(), false);
  assert.equal(reloads, 0);
});

// — write ——————————————————————————————————————————————————————————————————

test("progress changes are mirrored, debounced", async () => {
  reset();
  const { setValue } = await import("../js/storage.js");
  installSaveMirror();

  setValue("latest_zone", 1011);
  setValue("player.0.inventory.amount.7000", 12);
  assert.equal(writes.length, 0, "nothing goes out until the burst settles");

  globalThis.window.saveMirror.flush();
  assert.equal(writes.length, 1, "a burst of key writes collapses into one file write");
  const blob = JSON.parse(writes[0]);
  assert.equal(blob.kv.latest_zone, "1011");
  assert.equal(blob.kv["player.0.inventory.amount.7000"], "12");
});

test("an unchanged save is not rewritten", async () => {
  reset();
  const { setValue } = await import("../js/storage.js");
  installSaveMirror();
  setValue("latest_zone", 1011);
  globalThis.window.saveMirror.flush();
  globalThis.window.saveMirror.flush();
  assert.equal(writes.length, 1);
});

test("an empty save never overwrites the mirror", async () => {
  // A boot that hasn't built state yet, or a page mid-wipe, must not erase the
  // backup by mirroring nothing over it.
  reset();
  installSaveMirror();
  globalThis.window.saveMirror.flush();
  assert.equal(writes.length, 0);
});

test("off the native shells nothing is mirrored", async () => {
  reset({ native: null });
  const { setValue } = await import("../js/storage.js");
  installSaveMirror();
  setValue("latest_zone", 1011);
  assert.equal(globalThis.window.saveMirror, undefined, "not even the debug hook is installed");
  assert.equal(writes.length, 0);
});

// — the New Game regression ————————————————————————————————————————————————

test("New game clears the mirror, so the wiped save cannot come back", async () => {
  reset();
  const { setValue } = await import("../js/storage.js");
  installSaveMirror();
  setValue("latest_zone", 1011);
  globalThis.window.saveMirror.flush();
  assert.equal(writes.length, 1);

  // What the menu's New game handler does: wipe localStorage, then drop the
  // shell's copy too.
  fakeLS.clear();
  clearMirror();

  const cleared = JSON.parse(writes.at(-1));
  assert.deepEqual(cleared.kv, {}, "the shell is told the save is gone");

  // Next boot: an empty store and a mirror that carries nothing.
  reset({ native: { platform: "android", mirror: cleared, legacy: null } });
  assert.equal(await restoreFromNativeMirror(), false,
    "without this the player gets back the game they just deleted");
  assert.equal(reloads, 0);
});
