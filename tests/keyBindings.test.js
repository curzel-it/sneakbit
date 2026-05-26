// Key bindings: cover the action lookup, the conflict-clearing rebind,
// and the reset hook.

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

const mod = await import("../js/keyBindings.js");
const { codesFor, actionForCode, matchesAction, setBinding, resetBindings, _resetBindingsForTesting } = mod;

test("defaults: WASD + arrows + action keys", () => {
  _resetBindingsForTesting();
  assert.deepEqual(codesFor("moveUp"),    ["ArrowUp",    "KeyW"]);
  assert.deepEqual(codesFor("moveDown"),  ["ArrowDown",  "KeyS"]);
  assert.deepEqual(codesFor("moveLeft"),  ["ArrowLeft",  "KeyA"]);
  assert.deepEqual(codesFor("moveRight"), ["ArrowRight", "KeyD"]);
  assert.deepEqual(codesFor("interact"),  ["KeyE",       "Enter"]);
  assert.deepEqual(codesFor("shoot"),     ["KeyF",       "KeyJ"]);
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
