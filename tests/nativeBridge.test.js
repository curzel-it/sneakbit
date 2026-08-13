// Envelope validation for the native save bridge. The shells hand this over at
// boot and it decides whether the game is running inside one — a payload we
// half-understand must read as "not native" rather than reaching the import
// path, where a bogus `legacy.save` would replace a real save.

import { test } from "node:test";
import assert from "node:assert/strict";

// Fakes must be installed before the import: the module reads localStorage for
// its "no shell here" memo and fetch for the boot probe.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

let fetches = 0;
let respond = () => { throw new Error("no fetch configured"); };
globalThis.fetch = async (...args) => { fetches++; return respond(...args); };

globalThis.location = { protocol: "https:", host: "sneakbit.curzel.it" };
const MEMO_KEY = "sneakbit.nativeShell.v1";

const { parseNativeState, initNativeBridge, isNativeShell, requestShellQuit, _resetNativeBridgeForTesting } =
  await import("../js/nativeBridge.js");

const FULL = {
  platform: "ios",
  mirror: { v: 1, kv: { latest_zone: "1011" }, bindings: {}, language: null },
  legacy: { save: { latest_world: 1011 }, audio: { sfx: true, music: false } },
};

test("a well-formed envelope survives round-trip", () => {
  const state = parseNativeState(FULL);
  assert.equal(state.platform, "ios");
  assert.deepEqual(state.mirror, FULL.mirror);
  assert.deepEqual(state.legacy.save, { latest_world: 1011 });
  assert.deepEqual(state.legacy.audio, { sfx: true, music: false });
});

test("all three shells are recognised", () => {
  for (const platform of ["ios", "android", "electron"]) {
    assert.equal(parseNativeState({ platform }).platform, platform);
  }
});

test("anything that isn't a shell envelope reads as not-native", () => {
  for (const bad of [null, undefined, "{}", 42, [], {}, { platform: "web" }, { platform: 7 }]) {
    assert.equal(parseNativeState(bad), null, `${JSON.stringify(bad)} must not pass`);
  }
});

test("null members are the shells' way of saying 'nothing on disk'", () => {
  const state = parseNativeState({ platform: "electron", mirror: null, legacy: null });
  assert.equal(state.mirror, null);
  assert.equal(state.legacy, null);
});

test("non-object members are discarded rather than trusted", () => {
  const state = parseNativeState({
    platform: "android",
    mirror: "not an object",
    legacy: { save: [1, 2], audio: null },
  });
  assert.equal(state.mirror, null);
  assert.equal(state.legacy, null, "a legacy block with neither save nor audio is nothing");
});

test("a half-populated audio block is dropped whole", () => {
  // Defaulting the missing half to "enabled" would unmute a player who wasn't.
  const state = parseNativeState({
    platform: "ios",
    legacy: { save: { latest_world: 1001 }, audio: { sfx: false } },
  });
  assert.equal(state.legacy.audio, null);
  assert.deepEqual(state.legacy.save, { latest_world: 1001 });
});

test("audio flags must be booleans, not truthy numbers", () => {
  const state = parseNativeState({
    platform: "android",
    legacy: { save: { latest_world: 1001 }, audio: { sfx: 1, music: 0 } },
  });
  assert.equal(state.legacy.audio, null);
});

// — the boot probe ——————————————————————————————————————————————————————————

function reset() {
  store.clear();
  fetches = 0;
  globalThis.location = { protocol: "https:", host: "sneakbit.curzel.it" };
  _resetNativeBridgeForTesting();
}

const ok = (body) => ({ ok: true, json: async () => body });
const notFound = () => ({ ok: false, status: 404, json: async () => null });

test("a shell's envelope is picked up", async () => {
  reset();
  respond = () => ok(FULL);
  const state = await initNativeBridge();
  assert.equal(state.platform, "ios");
  assert.equal(isNativeShell(), true);
});

test("the web pays for the discovery once, not once per page load", async () => {
  reset();
  respond = () => notFound();
  await initNativeBridge();
  assert.equal(isNativeShell(), false);
  assert.equal(fetches, 1);
  assert.equal(store.get(MEMO_KEY), "https://sneakbit.curzel.it", "the answer is memoized");

  // A second page load in the same browser: fresh module state, same storage.
  _resetNativeBridgeForTesting();
  await initNativeBridge();
  assert.equal(fetches, 1, "nothing goes out again");
});

test("a 200 that isn't our envelope also settles the question", async () => {
  // A web host with a catch-all route answers 200 with an HTML shell.
  reset();
  respond = () => ok({ hello: "world" });
  await initNativeBridge();
  assert.equal(isNativeShell(), false);
  assert.equal(store.get(MEMO_KEY), "https://sneakbit.curzel.it");
});

test("a timeout is never remembered as 'no shell here'", async () => {
  // Caching an inconclusive failure inside a real shell would silently retire
  // the save mirror for the life of the install.
  reset();
  respond = () => { throw new Error("TimeoutError"); };
  await initNativeBridge();
  assert.equal(isNativeShell(), false);
  assert.equal(store.get(MEMO_KEY), undefined, "the next boot must try again");
});

// — the quit channel ————————————————————————————————————————————————————————

test("only the desktop shell is ever asked to quit", async () => {
  // The mobile shells have no business terminating themselves, and on the web
  // there's nothing on the other end of the request.
  for (const platform of ["ios", "android"]) {
    reset();
    _resetNativeBridgeForTesting({ platform, mirror: null, legacy: null });
    assert.equal(await requestShellQuit(), false);
    assert.equal(fetches, 0, `${platform} must not send the request`);
  }
  reset();
  assert.equal(await requestShellQuit(), false, "the web has no shell to ask");
  assert.equal(fetches, 0);
});

test("the desktop shell gets a POST and answers for it", async () => {
  reset();
  _resetNativeBridgeForTesting({ platform: "electron", mirror: null, legacy: null });
  let seen = null;
  respond = (url, init) => { seen = { url, method: init?.method }; return { ok: true, status: 204 }; };
  assert.equal(await requestShellQuit(), true);
  assert.deepEqual(seen, { url: "/__native/quit", method: "POST" });
});

test("a shell that doesn't answer reports back rather than hanging", async () => {
  // The caller re-enables the menu button on false — pretending the app is
  // closing would leave the player looking at a dead menu.
  reset();
  _resetNativeBridgeForTesting({ platform: "electron", mirror: null, legacy: null });
  respond = () => { throw new Error("TimeoutError"); };
  assert.equal(await requestShellQuit(), false);
});

test("a verdict from the web doesn't follow a save backup into a shell", async () => {
  // saveBackup.js copies every sneakbit.* key. Carried into the Steam or mobile
  // build, a bare "not native" flag would retire that install's save mirror for
  // good — and silently, because the mirror only matters once it's needed.
  reset();
  respond = () => notFound();
  await initNativeBridge();
  assert.equal(store.get(MEMO_KEY), "https://sneakbit.curzel.it");

  // Same storage, now inside the desktop/iOS shell.
  _resetNativeBridgeForTesting();
  globalThis.location = { protocol: "app:", host: "sneakbit.curzel.it" };
  respond = () => ok(FULL);
  assert.notEqual(await initNativeBridge(), null, "the shell is still discovered");
  assert.equal(fetches, 2);
});
