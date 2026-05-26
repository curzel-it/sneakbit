// Co-op mode flag persists in localStorage and exposes the per-player
// keymap that input.js / interact.js / shooting.js / melee.js consult
// when coop is on.

import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = (() => {
  const m = new Map();
  return {
    get length() { return m.size; },
    key: (i) => Array.from(m.keys())[i],
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
  };
})();

const { isCoopMode, setCoopMode, COOP_KEYMAPS, _setCoopModeForTesting } =
  await import("../js/coopMode.js");

test("defaults to disabled", () => {
  _setCoopModeForTesting(false);
  assert.equal(isCoopMode(), false);
});

test("setCoopMode toggles and persists", () => {
  setCoopMode(true);
  assert.equal(isCoopMode(), true);
  setCoopMode(false);
  assert.equal(isCoopMode(), false);
});

test("COOP_KEYMAPS assigns P1 WASD+ZXC and P2 IJKL+BNM", () => {
  assert.equal(COOP_KEYMAPS[1].moveUp,   "KeyW");
  assert.equal(COOP_KEYMAPS[1].interact, "KeyZ");
  assert.equal(COOP_KEYMAPS[1].shoot,    "KeyX");
  assert.equal(COOP_KEYMAPS[1].melee,    "KeyC");
  assert.equal(COOP_KEYMAPS[2].moveUp,   "KeyI");
  assert.equal(COOP_KEYMAPS[2].interact, "KeyB");
  assert.equal(COOP_KEYMAPS[2].shoot,    "KeyN");
  assert.equal(COOP_KEYMAPS[2].melee,    "KeyM");
});
