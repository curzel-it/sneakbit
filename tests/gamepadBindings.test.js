// Gamepad button bindings: defaults, per-player isolation, conflict-
// clearing rebind, reset, and a localStorage round-trip. Mirrors
// keyBindings.test.js. Button index 0 (A) must be treated as a real
// binding, never as "unbound".

import { test } from "node:test";
import assert from "node:assert/strict";

// Stub localStorage so the module can load + persist without erroring.
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

const mod = await import("../js/gamepadBindings.js?v=20260530b");
const {
  GAMEPAD_ACTIONS, GAMEPAD_ACTIONS_P2,
  buttonFor, actionForButton, menuButton,
  setGamepadBinding, resetGamepadBindings, _resetGamepadBindingsForTesting,
} = mod;

test("defaults match the standard Xbox-style layout", () => {
  _resetGamepadBindingsForTesting();
  assert.equal(buttonFor("interact"), 0);
  assert.equal(buttonFor("shoot"), 1);
  assert.equal(buttonFor("melee"), 2);
  assert.equal(buttonFor("menu"), 9);
  assert.equal(menuButton(), 9);
});

test("button index 0 is a real binding, not unbound", () => {
  _resetGamepadBindingsForTesting();
  assert.equal(actionForButton(0, 0), "interact");
});

test("actionForButton resolves the bound action, null otherwise", () => {
  _resetGamepadBindingsForTesting();
  assert.equal(actionForButton(1, 0), "shoot");
  assert.equal(actionForButton(7, 0), null);
});

test("P2 has no menu action", () => {
  _resetGamepadBindingsForTesting();
  assert.equal(buttonFor("menu", 1), -1);
  assert.ok(!GAMEPAD_ACTIONS_P2.some(a => a.id === "menu"));
  assert.ok(GAMEPAD_ACTIONS.some(a => a.id === "menu"));
});

test("rebinding clears the button off the player's other actions", () => {
  _resetGamepadBindingsForTesting();
  // Move shoot onto button 0, which interact currently owns.
  setGamepadBinding("shoot", 0, 0);
  assert.equal(buttonFor("shoot", 0), 0);
  assert.equal(buttonFor("interact", 0), -1, "interact lost button 0");
});

test("bindings are per-player — rebinding P1 leaves P2 untouched", () => {
  _resetGamepadBindingsForTesting();
  setGamepadBinding("shoot", 3, 0); // P1 only
  assert.equal(buttonFor("shoot", 0), 3);
  assert.equal(buttonFor("shoot", 1), 1, "P2 shoot unchanged");
});

test("unbinding with -1 leaves the action with no button", () => {
  _resetGamepadBindingsForTesting();
  setGamepadBinding("melee", -1, 0);
  assert.equal(buttonFor("melee", 0), -1);
  assert.equal(actionForButton(2, 0), null);
});

test("reset restores defaults for the given player", () => {
  _resetGamepadBindingsForTesting();
  setGamepadBinding("shoot", 5, 0);
  resetGamepadBindings(0);
  assert.equal(buttonFor("shoot", 0), 1);
});

test("P3 and P4 default to the A/B/X layout (no menu) so a 3rd/4th pad works", () => {
  _resetGamepadBindingsForTesting();
  for (const pi of [2, 3]) {
    assert.equal(buttonFor("interact", pi), 0);
    assert.equal(buttonFor("shoot", pi), 1);
    assert.equal(buttonFor("melee", pi), 2);
    assert.equal(buttonFor("menu", pi), -1, `P${pi+1} has no menu`);
  }
});

test("controller bindings are independent across all four players", () => {
  _resetGamepadBindingsForTesting();
  setGamepadBinding("shoot", 3, 2); // P3 shoot → Y
  assert.equal(buttonFor("shoot", 2), 3);
  assert.equal(buttonFor("shoot", 0), 1, "P1 unchanged");
  assert.equal(buttonFor("shoot", 1), 1, "P2 unchanged");
  assert.equal(buttonFor("shoot", 3), 1, "P4 unchanged");
});

test("changes persist across a reload (localStorage round-trip)", async () => {
  _resetGamepadBindingsForTesting();
  setGamepadBinding("shoot", 3, 0);
  setGamepadBinding("menu", 8, 0);
  // Fresh module instance reads the persisted blob.
  const fresh = await import("../js/gamepadBindings.js?v=roundtrip");
  assert.equal(fresh.buttonFor("shoot", 0), 3);
  assert.equal(fresh.menuButton(), 8);
});
