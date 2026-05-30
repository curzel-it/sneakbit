// Device-correct glyph labels: glyphForAction follows the active input
// device and the player's actual binding; formatters cover the edges.

import { test } from "node:test";
import assert from "node:assert/strict";

// keyBindings persists to localStorage on rebind — stub it.
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

const { glyphForAction, formatKeyCode, formatPadButton, confirmGlyph, backGlyph } =
  await import("../js/inputGlyphs.js?v=20260530g");
const { markInputDevice, _resetActiveInputDeviceForTesting } =
  await import("../js/activeInputDevice.js?v=20260530g");
const { setBinding, _resetBindingsForTesting } =
  await import("../js/keyBindings.js?v=20260530g");
const { setGamepadBinding, _resetGamepadBindingsForTesting } =
  await import("../js/gamepadBindings.js?v=20260530g");

test("formatKeyCode trims the common code prefixes", () => {
  assert.equal(formatKeyCode("KeyE"), "E");
  assert.equal(formatKeyCode("Digit1"), "1");
  assert.equal(formatKeyCode("Numpad8"), "Num 8");
  assert.equal(formatKeyCode("Escape"), "Escape");
  assert.equal(formatKeyCode(""), "—");
});

test("formatPadButton maps Standard Mapping indices (0 = A, not unbound)", () => {
  assert.equal(formatPadButton(0), "A");
  assert.equal(formatPadButton(1), "B");
  assert.equal(formatPadButton(9), "Start");
  assert.equal(formatPadButton(17), "Button 17");
  assert.equal(formatPadButton(-1), "—");
});

test("glyphForAction shows the keyboard binding in keyboard mode", () => {
  _resetActiveInputDeviceForTesting("keyboard");
  _resetBindingsForTesting();
  assert.equal(glyphForAction("interact"), "E"); // KeyE default
});

test("glyphForAction shows the pad button in gamepad mode", () => {
  _resetActiveInputDeviceForTesting("keyboard");
  _resetGamepadBindingsForTesting();
  markInputDevice("gamepad");
  assert.equal(glyphForAction("interact"), "A"); // button 0 default
  assert.equal(glyphForAction("shoot"), "B");
});

test("glyphForAction reflects rebinds", () => {
  _resetActiveInputDeviceForTesting("keyboard");
  _resetBindingsForTesting();
  _resetGamepadBindingsForTesting();
  setBinding("interact", 0, "KeyZ", 0);
  assert.equal(glyphForAction("interact"), "Z");
  markInputDevice("gamepad");
  setGamepadBinding("interact", 3, 0); // Y
  assert.equal(glyphForAction("interact"), "Y");
});

test("confirm/back glyphs follow the active device convention", () => {
  _resetActiveInputDeviceForTesting("keyboard");
  assert.equal(confirmGlyph(), "Enter");
  assert.equal(backGlyph(), "Esc");
  markInputDevice("gamepad");
  assert.equal(confirmGlyph(), "A");
  assert.equal(backGlyph(), "B");
});
