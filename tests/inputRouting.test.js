// Count-gated keyboard → slot routing for local co-op. A player's movement
// key only routes to its 1-based input slot when the local player count
// covers that player; keys for not-yet-active players are dropped. Drives
// input.resolveDirection via its test seam (no DOM). resolveDirection
// returns { playerIndex: slot (1-based), direction }.

import { test } from "node:test";
import assert from "node:assert/strict";

const { _resolveDirectionForTesting } = await import("../js/input.js?v=20260530a");
const { setBinding, _resetBindingsForTesting } = await import("../js/keyBindings.js?v=20260530a");
const { setLocalPlayerCount } = await import("../js/coopMode.js?v=20260530a");

// P1/P2 have keyboard defaults (KeyW / KeyI for moveUp); P3/P4 start empty,
// so we assign distinct keys for them.
const P3_UP = "Numpad8";
const P4_UP = "Numpad5";

function bindExtras() {
  _resetBindingsForTesting();           // wipes P3/P4 back to empty
  setBinding("moveUp", 0, P3_UP, 2);    // P3
  setBinding("moveUp", 0, P4_UP, 3);    // P4
}

function slotOf(code) {
  const r = _resolveDirectionForTesting(code);
  return r ? r.playerIndex : null; // playerIndex here is the 1-based slot
}

for (const count of [2, 3, 4]) {
  test(`local count ${count}: each active player's key routes to its slot`, () => {
    bindExtras();
    setLocalPlayerCount(count);

    // P1 always active → slot 1.
    assert.deepEqual(_resolveDirectionForTesting("KeyW"), { playerIndex: 1, direction: "up" });
    // P2 active for count >= 2 → slot 2.
    assert.equal(slotOf("KeyI"), 2);
    // P3 → slot 3 only when count >= 3, else gated out.
    assert.equal(slotOf(P3_UP), count >= 3 ? 3 : null);
    // P4 → slot 4 only when count >= 4, else gated out.
    assert.equal(slotOf(P4_UP), count >= 4 ? 4 : null);
  });
}

test("single-player (count 1): only P1 keys route", () => {
  bindExtras();
  setLocalPlayerCount(1);
  assert.equal(slotOf("KeyW"), 1);
  assert.equal(slotOf("KeyI"), null);  // P2 inactive
  assert.equal(slotOf(P3_UP), null);
  assert.equal(slotOf(P4_UP), null);
});

test("unbound keys never route", () => {
  bindExtras();
  setLocalPlayerCount(4);
  assert.equal(slotOf("F9"), null);
});
