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

// Electron's channel is a POST — the only one of the three where a write can
// still be in flight when the caller wants to navigate away. `holdPosts` keeps
// one open so a test can prove the caller really waits for it.
const posts = [];
let holdPosts = false;
let releasePost = null;
globalThis.fetch = (url, init) => {
  posts.push({ url, body: init?.body });
  if (!holdPosts) return Promise.resolve({ ok: true, status: 204 });
  return new Promise((resolve) => { releasePost = () => resolve({ ok: true, status: 204 }); });
};

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
  posts.length = 0;
  holdPosts = false;
  releasePost = null;
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

test("a restore that never reaches localStorage does not reload", async () => {
  // saveBlob's writeKv rolls back and swallows a failed write rather than
  // throwing, so applyBlob returning is not proof the save landed. Reloading
  // anyway would come straight back to the same empty store and the same
  // mirror — a boot loop under the loading screen, with no way out.
  reset({ native: { platform: "android", mirror: MIRROR, legacy: null } });
  const realSetItem = fakeLS.setItem;
  fakeLS.setItem = () => { throw new Error("QuotaExceededError"); };
  try {
    assert.equal(await restoreFromNativeMirror(), false);
    assert.equal(reloads, 0, "a boot that can't write must not reload forever");
  } finally {
    fakeLS.setItem = realSetItem;
  }
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
  await clearMirror();

  const cleared = JSON.parse(writes.at(-1));
  assert.deepEqual(cleared.kv, {}, "the shell is told the save is gone");

  // Next boot: an empty store and a mirror that carries nothing.
  reset({ native: { platform: "android", mirror: cleared, legacy: null } });
  assert.equal(await restoreFromNativeMirror(), false,
    "without this the player gets back the game they just deleted");
  assert.equal(reloads, 0);
});

test("clearing the mirror on Steam waits for the write to land", async () => {
  // On Electron the write is a POST and New game navigates the moment
  // clearMirror() returns, so the two race. `keepalive` does win that race
  // today, but this is the one write whose loss hands the player back the save
  // they just deleted — so the caller waits for it rather than trusting a
  // best-effort browser affordance to keep winning.
  reset({ native: { platform: "electron", mirror: null, legacy: null } });
  holdPosts = true;

  let settled = false;
  const clearing = clearMirror().then(() => { settled = true; });

  assert.equal(posts.length, 1, "the write goes out immediately");
  assert.equal(posts[0].url, "/__native/mirror");
  await Promise.resolve();
  assert.equal(settled, false, "clearMirror must not resolve while the write is in flight");

  releasePost();
  await clearing;
  assert.equal(settled, true);
  assert.deepEqual(JSON.parse(posts[0].body).kv, {}, "the shell is told the save is gone");
});
