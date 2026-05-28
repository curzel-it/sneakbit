// Key bindings: action lookup, conflict-clearing rebind, the reset hook,
// and the v2 per-player layout (P1 + P2 share one storage blob and
// cross-clear physical keys to avoid local-coop double-routing).

import { test } from "node:test";
import assert from "node:assert/strict";

// Stub localStorage so the module can load without erroring.
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

const mod = await import("../js/keyBindings.js?v=20260528g");
const {
  ACTIONS, ACTIONS_P2,
  codesFor, actionForCode, matchesAction, resolveAction,
  setBinding, resetBindings, _resetBindingsForTesting,
} = mod;

test("defaults: WASD + arrows + action keys", () => {
  _resetBindingsForTesting();
  assert.deepEqual(codesFor("moveUp"),    ["ArrowUp",    "KeyW"]);
  assert.deepEqual(codesFor("moveDown"),  ["ArrowDown",  "KeyS"]);
  assert.deepEqual(codesFor("moveLeft"),  ["ArrowLeft",  "KeyA"]);
  assert.deepEqual(codesFor("moveRight"), ["ArrowRight", "KeyD"]);
  assert.deepEqual(codesFor("interact"),  ["KeyE",       "Enter"]);
  assert.deepEqual(codesFor("shoot"),     ["KeyF",       ""]);
  assert.deepEqual(codesFor("melee"),     ["KeyG",       ""]);
});

test("P1 and P2 defaults have zero overlap", () => {
  _resetBindingsForTesting();
  const p1Codes = new Set();
  for (const a of ["moveUp","moveDown","moveLeft","moveRight","interact","shoot","melee","menu"]) {
    for (const c of codesFor(a, 0)) if (c) p1Codes.add(c);
  }
  for (const a of ["moveUp","moveDown","moveLeft","moveRight","interact","shoot","melee"]) {
    for (const c of codesFor(a, 1)) {
      if (!c) continue;
      assert.equal(p1Codes.has(c), false, `P2 ${a}=${c} collides with P1`);
    }
  }
});

test("menu defaults drop KeyM so P2's melee doesn't pop the pause overlay", () => {
  _resetBindingsForTesting();
  assert.deepEqual(codesFor("menu"), ["Escape", ""]);
  assert.equal(matchesAction("menu", "KeyM"), false);
  assert.equal(matchesAction("menu", "Escape"), true);
});

test("actionForCode maps both primary and secondary bindings", () => {
  _resetBindingsForTesting();
  assert.equal(actionForCode("KeyW"), "moveUp");
  assert.equal(actionForCode("ArrowUp"), "moveUp");
  assert.equal(actionForCode("KeyF"), "shoot");
  assert.equal(actionForCode("AltLeft"), null);
});

test("matchesAction is true only for codes bound to that action", () => {
  _resetBindingsForTesting();
  assert.equal(matchesAction("melee", "KeyG"), true);
  assert.equal(matchesAction("melee", "KeyF"), false);
});

test("setBinding writes the new code and removes it from any other action", () => {
  _resetBindingsForTesting();
  // Move 'shoot' onto KeyW (currently moveUp's secondary). KeyW should
  // no longer count as moveUp after the rebind.
  setBinding("shoot", 0, "KeyW");
  assert.equal(matchesAction("shoot", "KeyW"), true);
  assert.equal(matchesAction("moveUp", "KeyW"), false);
  // moveUp's primary (ArrowUp) should be untouched.
  assert.equal(matchesAction("moveUp", "ArrowUp"), true);
});

test("resetBindings restores the defaults", () => {
  _resetBindingsForTesting();
  setBinding("shoot", 0, "KeyZ");
  assert.equal(matchesAction("shoot", "KeyZ"), true);
  resetBindings();
  assert.equal(matchesAction("shoot", "KeyZ"), false);
  assert.equal(matchesAction("shoot", "KeyF"), true);
});

test("P2 defaults match the original COOP keymap (IJKL + B/N/M)", () => {
  _resetBindingsForTesting();
  assert.deepEqual(codesFor("moveUp",    1), ["KeyI", ""]);
  assert.deepEqual(codesFor("moveDown",  1), ["KeyK", ""]);
  assert.deepEqual(codesFor("moveLeft",  1), ["KeyJ", ""]);
  assert.deepEqual(codesFor("moveRight", 1), ["KeyL", ""]);
  assert.deepEqual(codesFor("interact",  1), ["KeyB", ""]);
  assert.deepEqual(codesFor("shoot",     1), ["KeyN", ""]);
  assert.deepEqual(codesFor("melee",     1), ["KeyM", ""]);
});

test("ACTIONS_P2 omits the menu action", () => {
  assert.equal(ACTIONS_P2.find(a => a.id === "menu"), undefined);
  assert.ok(ACTIONS.find(a => a.id === "menu"));
});

test("resolveAction returns the right player for each side of the keymap", () => {
  _resetBindingsForTesting();
  assert.deepEqual(resolveAction("KeyW"), { playerIndex: 0, action: "moveUp" });
  assert.deepEqual(resolveAction("KeyI"), { playerIndex: 1, action: "moveUp" });
  assert.deepEqual(resolveAction("KeyN"), { playerIndex: 1, action: "shoot" });
  assert.deepEqual(resolveAction("KeyM"), { playerIndex: 1, action: "melee" });
  assert.equal(resolveAction("AltLeft"), null);
});

test("setBinding cross-clears the same code from the other player's slot", () => {
  _resetBindingsForTesting();
  // P1 rebinds shoot to KeyN — which is P2's default shoot. P2 must
  // lose the binding so a single 'N' press doesn't route to both.
  setBinding("shoot", 0, "KeyN", 0);
  assert.equal(matchesAction("shoot", "KeyN", 0), true);
  assert.equal(matchesAction("shoot", "KeyN", 1), false);
});

test("resetBindings can target a single player", () => {
  _resetBindingsForTesting();
  setBinding("shoot", 0, "KeyZ", 1);
  assert.equal(matchesAction("shoot", "KeyZ", 1), true);
  resetBindings(1);
  // P2 reset to defaults.
  assert.equal(matchesAction("shoot", "KeyZ", 1), false);
  assert.equal(matchesAction("shoot", "KeyN", 1), true);
});
