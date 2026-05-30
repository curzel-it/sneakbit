// Co-op mode flag is in-memory only (any reload returns to single-
// player) and exposes the per-player keymap that input.js / interact.js
// / shooting.js / melee.js consult when coop is on.

import { test } from "node:test";
import assert from "node:assert/strict";

const { isCoopMode, setCoopMode, COOP_KEYMAPS, _setCoopModeForTesting,
  localPlayerCount, setLocalPlayerCount, isCoopActive, setNetworkGuestCount } =
  await import("../js/coopMode.js?v=20260530f");

test("defaults to disabled", () => {
  _setCoopModeForTesting(false);
  assert.equal(isCoopMode(), false);
});

test("setCoopMode toggles in-memory flag", () => {
  setCoopMode(true);
  assert.equal(isCoopMode(), true);
  setCoopMode(false);
  assert.equal(isCoopMode(), false);
});

test("local player count: 1 = single-player, 2+ = co-op", () => {
  setLocalPlayerCount(1);
  assert.equal(localPlayerCount(), 1);
  assert.equal(isCoopMode(), false);
  for (const n of [2, 3, 4]) {
    setLocalPlayerCount(n);
    assert.equal(localPlayerCount(), n);
    assert.equal(isCoopMode(), true, `count ${n} is co-op`);
  }
});

test("setLocalPlayerCount clamps to 1..4", () => {
  setLocalPlayerCount(0);
  assert.equal(localPlayerCount(), 1);
  setLocalPlayerCount(9);
  assert.equal(localPlayerCount(), 4);
});

test("setCoopMode stays compatible (on→>=2, off→1)", () => {
  setLocalPlayerCount(1);
  setCoopMode(true);
  assert.equal(localPlayerCount(), 2);
  setLocalPlayerCount(4);
  setCoopMode(true); // already co-op — keep the higher count
  assert.equal(localPlayerCount(), 4);
  setCoopMode(false);
  assert.equal(localPlayerCount(), 1);
});

test("isCoopActive also covers network guests with no local co-op", () => {
  setLocalPlayerCount(1);
  setNetworkGuestCount(1);
  assert.equal(isCoopActive(), true);
  setNetworkGuestCount(0);
  assert.equal(isCoopActive(), false);
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
