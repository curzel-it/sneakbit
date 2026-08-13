// "Exit game" — the pause menu's way out of the desktop build.
//
// Two things matter. It must not exist anywhere but the Steam/Electron shell
// (a web tab can't close itself; a mobile app that quits itself reads as a
// crash), and it must not leave the player's last few seconds of play behind:
// the process dies the moment the shell accepts, so the saves are flushed
// first — but never at the cost of stranding a player on a menu that won't
// close.
//
// The fakes go in before the import: storage.js probes localStorage at load
// and nativeBridge caches the shell envelope.

import { test, mock } from "node:test";
import assert from "node:assert/strict";

const store = new Map();
globalThis.localStorage = {
  get length() { return store.size; },
  key: (i) => [...store.keys()][i] ?? null,
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

const posts = [];
let holdMirror = false;
globalThis.fetch = (url, init) => {
  posts.push(String(url));
  if (holdMirror && String(url).endsWith("/mirror")) return new Promise(() => {});
  return Promise.resolve({ ok: true, status: 204 });
};

let saves = 0;
globalThis.window = { addEventListener() {}, save: { now: () => { saves++; } } };
globalThis.location = { protocol: "app:", host: "sneakbit.curzel.it", pathname: "/" };

const KV = "sneakbit.kv.v1.";

const { _resetNativeBridgeForTesting } = await import("../js/nativeBridge.js");
const { _resetSaveMirrorForTesting } = await import("../js/saveMirror.js");
const { canExitGame, exitGame } = await import("../js/exitGame.js");

const ELECTRON = { platform: "electron", mirror: null, legacy: null };

function reset({ native = ELECTRON } = {}) {
  store.clear();
  // A save worth mirroring — without progress the mirror write is a no-op and
  // the flush wouldn't prove anything.
  store.set(`${KV}latest_zone`, "1011");
  posts.length = 0;
  holdMirror = false;
  saves = 0;
  _resetSaveMirrorForTesting();
  _resetNativeBridgeForTesting(native);
}

test("only the desktop shell offers a way out", () => {
  for (const platform of ["ios", "android"]) {
    reset({ native: { platform, mirror: null, legacy: null } });
    assert.equal(canExitGame(), false, `${platform} must not show the button`);
  }
  reset({ native: null });
  assert.equal(canExitGame(), false, "the web has nothing to quit");
  reset();
  assert.equal(canExitGame(), true);
});

test("nothing is asked to quit off the desktop shell", async () => {
  reset({ native: { platform: "ios", mirror: null, legacy: null } });
  assert.equal(await exitGame(), false);
  assert.deepEqual(posts, [], "no request, and no save flush either");
});

test("the save is flushed before the shell is asked to go down", async () => {
  reset();
  assert.equal(await exitGame(), true);
  assert.equal(saves, 1, "the live position is persisted synchronously first");
  assert.deepEqual(
    posts.map((u) => u.replace("/__native/", "")),
    ["mirror", "quit"],
    "the mirror write must land while the process is still alive"
  );
});

test("a shell that refuses to quit leaves the menu usable", async () => {
  reset();
  globalThis.fetch = (url) => {
    posts.push(String(url));
    if (String(url).endsWith("/quit")) return Promise.reject(new Error("no protocol handler"));
    return Promise.resolve({ ok: true, status: 204 });
  };
  const quitting = await exitGame();
  globalThis.fetch = (url) => { posts.push(String(url)); return Promise.resolve({ ok: true, status: 204 }); };
  assert.equal(quitting, false, "the caller has to be able to re-enable the button");
});

test("a wedged save write doesn't trap the player in the game", async () => {
  reset();
  holdMirror = true;
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const quitting = exitGame();
    // Let the flush start and park on the mirror write that never answers.
    await new Promise((r) => setImmediate(r));
    mock.timers.tick(2000);
    assert.equal(await quitting, true, "the exit goes ahead on the flush deadline");
    assert.ok(posts.some((u) => u.endsWith("/quit")));
  } finally {
    mock.timers.reset();
  }
});
