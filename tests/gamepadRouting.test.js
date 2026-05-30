// Tests the per-pad → per-slot routing added for local co-op controllers.
// navigator.getGamepads is stubbed with synthetic pad snapshots; the
// module reads it at call time so no JSDOM is needed.

import { test } from "node:test";
import assert from "node:assert/strict";

const gp = await import("../js/gamepad.js?v=20260531a");
const binds = await import("../js/gamepadBindings.js?v=20260531a");

// Build a Standard-Mapping pad. `buttons` is a sparse {index: true} map;
// axes default to neutral. The same object is returned on every
// getGamepads() call so button state persists across polls (edge logic).
function pad(index, { axes = [0, 0], buttons = {} } = {}) {
  const btns = [];
  for (let i = 0; i <= 15; i++) btns[i] = { pressed: !!buttons[i] };
  return { index, axes, buttons: btns, connected: true };
}

function setPads(...pads) {
  // Node 21+ ships a read-only built-in `navigator`, so assignment throws —
  // redefine the property instead.
  Object.defineProperty(globalThis, "navigator", {
    value: { getGamepads: () => pads },
    configurable: true,
    writable: true,
  });
}

test("connection order maps lowest-index pad to slot 1, next to slot 2", () => {
  gp._resetGamepadForTesting();
  setPads(pad(0), pad(3)); // hardware indices 0 and 3
  assert.equal(gp.getPadIndexForSlot(1), 0);
  assert.equal(gp.getPadIndexForSlot(2), 3);
  assert.equal(gp.getPadIndexForSlot(3), -1); // no third pad
});

test("a held direction emits one press edge, then holds with no repeat", () => {
  gp._resetGamepadForTesting();
  setPads(pad(0, { axes: [-1, 0] })); // left stick
  let r = gp.pollGamepadForSlot(1);
  assert.deepEqual(r.events, ["left"]);
  assert.deepEqual([...r.held], ["left"]);
  r = gp.pollGamepadForSlot(1); // still left — no new edge
  assert.deepEqual(r.events, []);
  assert.deepEqual([...r.held], ["left"]);
});

test("the stick maps to a single direction by 90° sector (dominant axis)", () => {
  gp._resetGamepadForTesting();
  // Pushed down-and-slightly-right: vertical dominates → only "down".
  setPads(pad(0, { axes: [0.4, 0.9] }));
  assert.deepEqual([...gp.pollGamepadForSlot(1).held], ["down"]);

  gp._resetGamepadForTesting();
  // Pushed right-and-slightly-up: horizontal dominates → only "right".
  setPads(pad(0, { axes: [0.9, -0.4] }));
  assert.deepEqual([...gp.pollGamepadForSlot(1).held], ["right"]);
});

test("a stick resting inside the deadzone registers nothing", () => {
  gp._resetGamepadForTesting();
  setPads(pad(0, { axes: [0.1, -0.15] })); // jitter, magnitude < 0.25
  assert.equal(gp.pollGamepadForSlot(1).held.size, 0);
});

test("d-pad and stick both feed the held set", () => {
  gp._resetGamepadForTesting();
  setPads(pad(0, { buttons: { 13: true } })); // d-pad down
  const r = gp.pollGamepadForSlot(1);
  assert.deepEqual([...r.held], ["down"]);
});

test("action callbacks fire on the rising edge for the matching slot only", () => {
  gp._resetGamepadForTesting();
  let p1shoot = 0, p2shoot = 0;
  gp.setGamepadAction("shoot", () => p1shoot++, 1);
  gp.setGamepadAction("shoot", () => p2shoot++, 2);
  setPads(pad(0, { buttons: { 1: true } }), pad(1)); // slot-1 pad holds B
  gp.pollGamepadForSlot(1);
  gp.pollGamepadForSlot(2);
  assert.equal(p1shoot, 1, "slot 1 pad pressed shoot");
  assert.equal(p2shoot, 0, "slot 2 pad did not");
  gp.pollGamepadForSlot(1); // button still held — no repeat
  assert.equal(p1shoot, 1);
});

test("rebinding shoot to a different button reroutes the action", () => {
  gp._resetGamepadForTesting();
  binds._resetGamepadBindingsForTesting();
  let shoots = 0;
  gp.setGamepadAction("shoot", () => shoots++, 1);
  binds.setGamepadBinding("shoot", 3, 0); // P1 shoot now on button 3 (Y)

  setPads(pad(0, { buttons: { 3: true } })); // press Y
  gp.pollGamepadForSlot(1);
  assert.equal(shoots, 1, "Y now fires shoot");

  gp._resetGamepadForTesting();
  setPads(pad(0, { buttons: { 1: true } })); // press B (old shoot)
  gp.pollGamepadForSlot(1);
  assert.equal(shoots, 1, "B no longer fires shoot");
  binds._resetGamepadBindingsForTesting();
});

test("readPadSnapshotForSlot honours rebound action buttons", () => {
  gp._resetGamepadForTesting();
  binds._resetGamepadBindingsForTesting();
  binds.setGamepadBinding("melee", 5, 0); // melee now on button 5
  setPads(pad(0, { buttons: { 5: true } }));
  const snap = gp.readPadSnapshotForSlot(1);
  assert.equal(snap.melee, true);
  assert.equal(snap.shoot, false);
  binds._resetGamepadBindingsForTesting();
});

test("polling a slot with no assigned pad returns empty", () => {
  gp._resetGamepadForTesting();
  setPads(pad(0));
  const r = gp.pollGamepadForSlot(2);
  assert.deepEqual(r.events, []);
  assert.equal(r.held.size, 0);
});

test("readPadSnapshotForSlot is side-effect-free (fires no callbacks)", () => {
  gp._resetGamepadForTesting();
  let shootCb = 0;
  gp.setGamepadAction("shoot", () => shootCb++, 1);
  setPads(pad(0, { axes: [1, 0], buttons: { 1: true } })); // right + B
  const snap = gp.readPadSnapshotForSlot(1);
  assert.deepEqual([...snap.held], ["right"]);
  assert.equal(snap.shoot, true);
  assert.equal(shootCb, 0, "snapshot read must not fire action callbacks");
});
